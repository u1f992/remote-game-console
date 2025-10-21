import argparse
import contextlib
import ctypes
import cv2
import dataclasses
import multiprocessing
import multiprocessing.sharedctypes
import numpy as np
import time
import typing

import remote_game_console.cv2_util
import remote_game_console.protocols


_DEFAULT_DROP_EARLY_FRAMES: typing.Final = 10
_DEFAULT_INITIALIZATION_TIMEOUT: typing.Final = 10.0


def add_arguments(parser: argparse.ArgumentParser) -> None:
    args: dict[str, dict[str, typing.Any]] = {
        "--video-capture": {"required": True, "type": int},
        "--video-backend": {"type": int},
        "--width": {"type": int},
        "--height": {"type": int},
        "--drop-early-frames": {
            "type": int,
            "default": _DEFAULT_DROP_EARLY_FRAMES,
            "help": f"default: {_DEFAULT_DROP_EARLY_FRAMES}",
        },
        "--initialization-timeout": {
            "type": float,
            "default": _DEFAULT_INITIALIZATION_TIMEOUT,
            "help": f"default: {_DEFAULT_INITIALIZATION_TIMEOUT}",
        },
    }
    for name, kwargs in args.items():
        parser.add_argument(name, **kwargs)


@dataclasses.dataclass(frozen=True)
class Arguments:
    index: int
    backend: int | None
    size: tuple[int | None, int | None]
    drop_early_frames: int
    initialization_timeout: float


def validate(args: argparse.Namespace) -> Arguments | None:
    if not isinstance(args.video_capture, int):
        return None
    index = args.video_capture

    if not (isinstance(args.video_backend, int) or args.video_backend is None):
        return None
    backend = args.video_backend

    if not (isinstance(args.width, int) or args.width is None) or not (
        isinstance(args.height, int) or args.height is None
    ):
        return None
    size = (
        max(1, args.width) if args.width is not None else None,
        max(1, args.height) if args.height is not None else None,
    )

    if not isinstance(args.drop_early_frames, int):
        return None
    drop_early_frames = args.drop_early_frames

    if not isinstance(args.initialization_timeout, float):
        return None
    initialization_timeout = args.initialization_timeout

    return Arguments(
        index,
        backend,
        size,
        drop_early_frames,
        initialization_timeout,
    )


_SharedBuffer = ctypes.Array[ctypes.c_uint8]


def _get_shared_buffer(args: Arguments) -> tuple[_SharedBuffer, tuple[int, int, int]]:
    with remote_game_console.cv2_util.VideoCapture(
        *((args.index, args.backend) if args.backend is not None else (args.index,))
    ) as cap:
        remote_game_console.cv2_util.set_size(cap, args.size)

        for _ in range(args.drop_early_frames):
            cap.read()
        ret, mat = cap.read()
        if not ret:
            raise RuntimeError("cannot get first frame")
        actual_shape = typing.cast(
            tuple[int, int, int], mat.shape
        )  # height, width, channels

        # Verify that the actual size matches the requested size
        actual_height, actual_width = actual_shape[0], actual_shape[1]
        requested_width, requested_height = args.size
        if requested_width is not None and requested_width != actual_width:
            raise RuntimeError(
                f"requested width {requested_width} does not match actual width {actual_width}"
            )
        if requested_height is not None and requested_height != actual_height:
            raise RuntimeError(
                f"requested height {requested_height} does not match actual height {actual_height}"
            )

        buffer_size = len(mat.tobytes())

    shared_buffer = multiprocessing.sharedctypes.RawArray(ctypes.c_uint8, buffer_size)
    return shared_buffer, actual_shape


def _daemon(
    shared_buffer: _SharedBuffer,
    actual_shape: tuple[int, int, int],
    args: Arguments,
    initialized: remote_game_console.protocols.Event,
    ready: remote_game_console.protocols.Event,
    frame_updated: remote_game_console.protocols.Event,
    frame_counter: remote_game_console.protocols.Value,
    cancel: remote_game_console.protocols.Event,
) -> None:
    mat = np.frombuffer(shared_buffer, dtype=np.uint8).reshape(actual_shape)
    with remote_game_console.cv2_util.VideoCapture(
        *((args.index, args.backend) if args.backend is not None else (args.index,))
    ) as cap:
        remote_game_console.cv2_util.set_size(cap, args.size)

        for _ in range(args.drop_early_frames):
            cap.read()

        initialized.set()

        first = True
        while not cancel.is_set():
            if first:
                first = False
            elif not ready.wait(timeout=1):
                raise TimeoutError("_daemon: ready.wait")

            ready.clear()
            try:
                ret = cap.read(mat)
                if not ret:
                    raise RuntimeError("cannot get frame")
                # Increment frame counter and signal that a new frame is available
                frame_counter.value += 1
                frame_updated.set()
            finally:
                ready.set()


class Video:
    def __init__(
        self,
        shared_buffer: _SharedBuffer,
        actual_shape: tuple[int, int, int],
        ready: remote_game_console.protocols.Event,
        frame_updated: remote_game_console.protocols.Event,
        frame_counter: remote_game_console.protocols.Value,
    ):
        self.__mat: cv2.typing.MatLike = np.frombuffer(
            shared_buffer, dtype=np.uint8
        ).reshape(actual_shape)
        self.__ready = ready
        self.__frame_updated = frame_updated
        self.__frame_counter = frame_counter
        self.__last_frame_count = 0

    @contextlib.contextmanager
    def get(
        self, wait_for_new_frame: bool = False, timeout: float | None = None
    ) -> typing.Generator[cv2.typing.MatLike, None, None]:
        start_time = time.time() if timeout is not None else None

        # If wait_for_new_frame is True, wait until a new frame is available
        if wait_for_new_frame:
            while True:
                current_count = self.__frame_counter.value
                if current_count != self.__last_frame_count:
                    self.__last_frame_count = current_count
                    break
                self.__frame_updated.clear()

                # Calculate remaining timeout
                remaining_timeout = timeout
                if start_time is not None and timeout is not None:
                    elapsed = time.time() - start_time
                    remaining_timeout = max(0, timeout - elapsed)

                if not self.__frame_updated.wait(remaining_timeout):
                    raise TimeoutError("_Video.get: frame_updated.wait")

        # Calculate remaining timeout for ready.wait()
        remaining_timeout = timeout
        if start_time is not None and timeout is not None:
            elapsed = time.time() - start_time
            remaining_timeout = max(0, timeout - elapsed)

        if not self.__ready.wait(remaining_timeout):
            raise TimeoutError("_Video.get: ready.wait")
        self.__ready.clear()
        try:
            yield self.__mat
        finally:
            self.__ready.set()


@contextlib.contextmanager
def start(
    args: Arguments, manager: remote_game_console.protocols.Manager
) -> typing.Generator[Video, None, None]:
    shared_buffer, actual_shape = _get_shared_buffer(args)
    initialized = manager.Event()
    ready = manager.Event()
    frame_updated = manager.Event()
    frame_counter = manager.Value("i", 0)
    cancel = manager.Event()
    daemon = multiprocessing.Process(
        target=_daemon,
        args=(
            shared_buffer,
            actual_shape,
            args,
            initialized,
            ready,
            frame_updated,
            frame_counter,
            cancel,
        ),
        daemon=True,
    )
    daemon.start()
    if not initialized.wait(timeout=args.initialization_timeout):
        raise TimeoutError("start: initialized.wait")
    try:
        yield Video(shared_buffer, actual_shape, ready, frame_updated, frame_counter)
    finally:
        cancel.set()
        try:
            daemon.join(timeout=1)
        except:  # noqa: E722 "Do not use bare `except`" from Ruff
            pass
