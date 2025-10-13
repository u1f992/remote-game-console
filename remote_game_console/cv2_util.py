import atexit
import cv2
import contextlib
import typing


@typing.overload
@contextlib.contextmanager
def VideoCapture() -> typing.Generator[cv2.VideoCapture, None, None]: ...


@typing.overload
@contextlib.contextmanager
def VideoCapture(
    filename: str,
    apiPreference: int = ...,
) -> typing.Generator[cv2.VideoCapture, None, None]: ...


@typing.overload
@contextlib.contextmanager
def VideoCapture(
    filename: str,
    apiPreference: int,
    params: typing.Sequence[int],
) -> typing.Generator[cv2.VideoCapture, None, None]: ...


@typing.overload
@contextlib.contextmanager
def VideoCapture(
    index: int,
    apiPreference: int = ...,
) -> typing.Generator[cv2.VideoCapture, None, None]: ...


@typing.overload
@contextlib.contextmanager
def VideoCapture(
    index: int,
    apiPreference: int,
    params: typing.Sequence[int],
) -> typing.Generator[cv2.VideoCapture, None, None]: ...


@typing.overload
@contextlib.contextmanager
def VideoCapture(
    source: cv2.IStreamReader, apiPreference: int, params: typing.Sequence[int]
) -> typing.Generator[cv2.VideoCapture, None, None]: ...


@contextlib.contextmanager
def VideoCapture(
    *args: typing.Any, **kwargs: typing.Any
) -> typing.Generator[cv2.VideoCapture, None, None]:
    cap = cv2.VideoCapture(*args, **kwargs)

    def try_release() -> None:
        try:
            cap.release()
        except:  # noqa: E722 "Do not use bare `except`" from Ruff
            pass

    try:
        atexit.register(try_release)
        yield cap
    finally:
        try_release()
        atexit.unregister(try_release)


def set_size(cap: cv2.VideoCapture, size: tuple[int | None, int | None]) -> bool:
    width, height = size
    w = cap.set(cv2.CAP_PROP_FRAME_WIDTH, width) if width is not None else True
    h = cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height) if height is not None else True
    return w and h
