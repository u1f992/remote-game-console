import argparse
import contextlib
import ctypes
import dataclasses
import multiprocessing
import multiprocessing.sharedctypes
import typing

import pyaudio  # type: ignore

import remote_game_console.protocols


_DEFAULT_RATE: typing.Final = 44100
_DEFAULT_CHANNELS: typing.Final = 2
_DEFAULT_CHUNK: typing.Final = 1024
_DEFAULT_FORMAT: typing.Final = pyaudio.paInt16
_DEFAULT_GAIN: typing.Final = 1.0
_DEFAULT_BUFFER_SIZE: typing.Final = 8  # Number of chunks to buffer (for compatibility)
# Common sample rates to test (may not be exhaustive)
_SAMPLE_RATES: typing.Final = [8000, 11025, 16000, 22050, 44100, 48000, 96000, 192000]


def add_arguments(parser: argparse.ArgumentParser) -> None:
    args: dict[str, dict[str, typing.Any]] = {
        "--audio-device": {"required": True, "type": int},
        "--audio-rate": {
            "type": int,
            "default": _DEFAULT_RATE,
            "help": f"default: {_DEFAULT_RATE}",
        },
        "--audio-channels": {
            "type": int,
            "default": _DEFAULT_CHANNELS,
            "help": f"default: {_DEFAULT_CHANNELS}",
        },
        "--audio-chunk": {
            "type": int,
            "default": _DEFAULT_CHUNK,
            "help": f"default: {_DEFAULT_CHUNK}",
        },
        "--audio-gain": {
            "type": float,
            "default": _DEFAULT_GAIN,
            "help": f"default: {_DEFAULT_GAIN}",
        },
        "--audio-buffer-chunks": {
            "type": int,
            "default": _DEFAULT_BUFFER_SIZE,
            "help": f"number of audio chunks to buffer (deprecated, kept for compatibility). default: {_DEFAULT_BUFFER_SIZE}",
        },
    }
    for name, kwargs in args.items():
        parser.add_argument(name, **kwargs)


@dataclasses.dataclass(frozen=True)
class Arguments:
    device: int
    rate: int
    channels: int
    chunk: int
    gain: float
    buffer_chunks: int


def validate(args: argparse.Namespace) -> Arguments | None:
    if not isinstance(args.audio_device, int):
        return None
    device = args.audio_device

    if not isinstance(args.audio_rate, int):
        return None
    rate = max(1, args.audio_rate)

    if not isinstance(args.audio_channels, int):
        return None
    channels = max(1, min(2, args.audio_channels))

    if not isinstance(args.audio_chunk, int):
        return None
    chunk = max(1, args.audio_chunk)

    if not isinstance(args.audio_gain, (int, float)):
        return None
    gain = max(0.0, float(args.audio_gain))

    if not isinstance(args.audio_buffer_chunks, int):
        return None
    buffer_chunks = max(1, args.audio_buffer_chunks)

    return Arguments(device, rate, channels, chunk, gain, buffer_chunks)


_SharedBuffer = ctypes.Array[ctypes.c_uint8]


def _get_chunk_size(args: Arguments) -> int:
    """Calculate the size of one audio chunk in bytes."""
    # paInt16 = 2 bytes per sample
    # chunk = number of frames
    # channels = number of channels
    return args.chunk * args.channels * 2


def _daemon(
    shared_buffer: _SharedBuffer,
    args: Arguments,
    ready: remote_game_console.protocols.Event,
    cancel: remote_game_console.protocols.Event,
) -> None:
    p = pyaudio.PyAudio()
    try:
        stream = p.open(
            format=_DEFAULT_FORMAT,
            channels=args.channels,
            rate=args.rate,
            input=True,
            input_device_index=args.device,
            frames_per_buffer=args.chunk,
        )
        try:
            while not cancel.is_set():
                try:
                    # Read audio data
                    data = stream.read(args.chunk, exception_on_overflow=False)

                    # Wait for ready signal and write to shared buffer
                    if not ready.wait(timeout=1):
                        continue
                    ready.clear()
                    try:
                        # Copy data to shared buffer
                        chunk_bytes = bytes(data)
                        for i, byte in enumerate(chunk_bytes):
                            shared_buffer[i] = byte
                    finally:
                        ready.set()
                except Exception as e:
                    print(f"Audio read error: {e}")
                    break
        finally:
            stream.stop_stream()
            stream.close()
    finally:
        p.terminate()


class Audio:
    def __init__(
        self,
        shared_buffer: _SharedBuffer,
        chunk_size: int,
        ready: remote_game_console.protocols.Event,
        rate: int,
        channels: int,
        gain: float,
    ):
        self.__shared_buffer = shared_buffer
        self.__chunk_size = chunk_size
        self.__ready = ready
        self.rate = rate
        self.channels = channels
        self.gain = gain
        self.sample_width = 2  # paInt16 = 2 bytes

    def get(self) -> bytes:
        """Get the latest audio chunk from shared buffer (non-destructive read)."""
        if not self.__ready.wait(timeout=1):
            raise TimeoutError("Audio.get: ready.wait timeout")
        self.__ready.clear()
        try:
            # Copy data from shared buffer
            data = bytes(self.__shared_buffer[: self.__chunk_size])
            return data
        finally:
            self.__ready.set()


def _test_device(args: Arguments) -> None:
    p = pyaudio.PyAudio()
    try:
        stream = p.open(
            format=_DEFAULT_FORMAT,
            channels=args.channels,
            rate=args.rate,
            input=True,
            input_device_index=args.device,
            frames_per_buffer=args.chunk,
        )
        stream.close()
    finally:
        p.terminate()


@contextlib.contextmanager
def start(
    args: Arguments, manager: remote_game_console.protocols.Manager
) -> typing.Generator[Audio, None, None]:
    _test_device(args)

    # Create shared buffer for one audio chunk
    chunk_size = _get_chunk_size(args)
    shared_buffer = multiprocessing.sharedctypes.RawArray(ctypes.c_uint8, chunk_size)

    ready = manager.Event()
    ready.set()  # Initially ready for writing
    cancel = manager.Event()

    daemon = multiprocessing.Process(
        target=_daemon,
        args=(shared_buffer, args, ready, cancel),
        daemon=True,
    )
    daemon.start()
    try:
        yield Audio(shared_buffer, chunk_size, ready, args.rate, args.channels, args.gain)
    finally:
        cancel.set()
        try:
            daemon.join(timeout=1)
        except:  # noqa: E722 "Do not use bare `except`" from Ruff
            pass


def list_devices() -> None:
    """List all available audio devices and their supported sample rates."""
    p = pyaudio.PyAudio()

    print("Available audio devices:")
    print("=" * 80)

    for i in range(p.get_device_count()):
        info = p.get_device_info_by_index(i)
        print(f"Device {i}: {info['name']}")
        print(f"  Max Input Channels: {info['maxInputChannels']}")
        print(f"  Max Output Channels: {info['maxOutputChannels']}")
        print(f"  Default Sample Rate: {info['defaultSampleRate']}")

        # Test supported sample rates for input
        if info["maxInputChannels"] > 0:
            supported_rates = []
            for rate in _SAMPLE_RATES:
                try:
                    if p.is_format_supported(
                        rate,
                        input_device=i,
                        input_channels=min(2, info["maxInputChannels"]),
                        input_format=_DEFAULT_FORMAT,
                    ):
                        supported_rates.append(rate)
                except:  # noqa: E722
                    pass

            if supported_rates:
                print(
                    f"  Supported Input Sample Rates: {', '.join(map(str, supported_rates))}"
                )

        print()

    print("=" * 80)
    print(f"Default input device: {p.get_default_input_device_info()['name']}")
    print(f"Default output device: {p.get_default_output_device_info()['name']}")

    p.terminate()
