import argparse
import contextlib
import dataclasses
import multiprocessing
import queue
import typing

import pyaudio  # type: ignore

import remote_game_console.protocols


_DEFAULT_RATE: typing.Final = 44100
_DEFAULT_CHANNELS: typing.Final = 2
_DEFAULT_CHUNK: typing.Final = 1024
_DEFAULT_FORMAT: typing.Final = pyaudio.paInt16
_DEFAULT_GAIN: typing.Final = 1.0
_DEFAULT_QUEUE_SIZE: typing.Final = 8
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
        "--audio-queue-size": {
            "type": int,
            "default": _DEFAULT_QUEUE_SIZE,
            "help": f"backend queue size, affects latency and stability. default: {_DEFAULT_QUEUE_SIZE}",
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
    queue_size: int


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

    if not isinstance(args.audio_queue_size, int):
        return None
    queue_size = max(1, args.audio_queue_size)

    return Arguments(device, rate, channels, chunk, gain, queue_size)


def _daemon(
    client_queues: remote_game_console.protocols.List,
    args: Arguments,
    cancel: remote_game_console.protocols.Event,
) -> None:
    # Track consecutive failures for each queue to detect disconnected clients
    failure_counts: dict[int, int] = {}
    MAX_CONSECUTIVE_FAILURES = args.queue_size * 2  # Threshold for removing stale queues

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
                    data = stream.read(args.chunk, exception_on_overflow=False)

                    # Broadcast to all client queues (iterate over a copy to allow safe removal)
                    current_queues = list(client_queues)
                    queues_to_remove = []

                    for q in current_queues:
                        queue_id = id(q)
                        try:
                            q.put_nowait(data)
                            # Reset failure count on success
                            failure_counts[queue_id] = 0
                        except queue.Full:
                            # Increment failure count
                            failure_counts[queue_id] = failure_counts.get(queue_id, 0) + 1

                            # Mark for removal if threshold exceeded
                            if failure_counts[queue_id] >= MAX_CONSECUTIVE_FAILURES:
                                queues_to_remove.append(q)

                    # Remove stale queues (likely disconnected clients)
                    for q in queues_to_remove:
                        try:
                            client_queues.remove(q)
                            queue_id = id(q)
                            if queue_id in failure_counts:
                                del failure_counts[queue_id]
                            print(f"Removed stale audio queue (consecutive failures: {MAX_CONSECUTIVE_FAILURES})")
                        except ValueError:
                            # Queue already removed
                            pass
                except Exception as e:
                    print(f"Audio read error: {e}")
                    break
        finally:
            stream.stop_stream()
            stream.close()
    finally:
        p.terminate()


class Audio:
    def __init__(self, audio_queue: remote_game_console.protocols.Queue, rate: int, channels: int, gain: float):
        self.__queue = audio_queue
        self.rate = rate
        self.channels = channels
        self.gain = gain
        self.sample_width = 2  # paInt16 = 2 bytes

    def get(self) -> bytes:
        try:
            # Get data from queue
            data = self.__queue.get(timeout=1)
            return data
        except queue.Empty:
            raise TimeoutError("Audio.get: queue.get timeout")


class AudioManager:
    """Manages audio broadcasting to multiple clients."""

    def __init__(
        self,
        client_queues: remote_game_console.protocols.List,
        manager: remote_game_console.protocols.Manager,
        rate: int,
        channels: int,
        gain: float,
        queue_size: int,
    ):
        self.__client_queues = client_queues
        self.__manager = manager
        self.rate = rate
        self.channels = channels
        self.gain = gain
        self.sample_width = 2  # paInt16 = 2 bytes
        self.__queue_size = queue_size

    def create_client(self) -> Audio:
        """Create a new Audio instance for a client with its own queue."""
        client_queue = self.__manager.Queue(maxsize=self.__queue_size)
        self.__client_queues.append(client_queue)
        return Audio(client_queue, self.rate, self.channels, self.gain)

    def remove_client(self, audio: Audio) -> None:
        """Remove a client's queue from the broadcast list."""
        try:
            self.__client_queues.remove(audio._Audio__queue)
        except ValueError:
            # Queue already removed
            pass


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
) -> typing.Generator[AudioManager, None, None]:
    _test_device(args)

    client_queues = manager.list()
    cancel = manager.Event()
    daemon = multiprocessing.Process(
        target=_daemon,
        args=(client_queues, args, cancel),
        daemon=True,
    )
    daemon.start()
    try:
        yield AudioManager(client_queues, manager, args.rate, args.channels, args.gain, args.queue_size)
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
