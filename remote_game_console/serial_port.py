import argparse
import contextlib
import dataclasses
import enum
import multiprocessing
import queue
import serial
import serial.tools.list_ports
import time
import typing

import remote_game_console.protocols

_Port = typing.NewType("_Port", str)


def _get_ports() -> frozenset[_Port]:
    return frozenset(
        [_Port(port.device) for port in serial.tools.list_ports.comports()]
    )


_PORTS: typing.Final = _get_ports()


def add_arguments(parser: argparse.ArgumentParser) -> None:
    args: dict[str, dict[str, typing.Any]] = {
        "--serial-port": {
            "required": True,
            "type": str,
            "help": f"{sorted(list(_PORTS))}",
        },
        "--keep-alive-interval": {
            "type": float,
            "default": None,
            "help": "send keep-alive input at specified interval in seconds to prevent sleep (default: None)",
        },
    }
    for name, kwargs in args.items():
        parser.add_argument(name, **kwargs)


@dataclasses.dataclass(frozen=True)
class Arguments:
    port: _Port
    keep_alive_interval: float | None


def validate(args: argparse.Namespace) -> Arguments | None:
    if args.serial_port not in _PORTS:
        return None
    port = typing.cast(_Port, args.serial_port)

    keep_alive_interval: float | None = None
    if args.keep_alive_interval is not None:
        if not isinstance(args.keep_alive_interval, (int, float)):
            return None
        if args.keep_alive_interval <= 0:
            return None
        keep_alive_interval = float(args.keep_alive_interval)

    return Arguments(port, keep_alive_interval)


class Button(enum.IntFlag):
    Y = enum.auto()
    B = enum.auto()
    A = enum.auto()
    X = enum.auto()
    L = enum.auto()
    R = enum.auto()
    ZL = enum.auto()
    ZR = enum.auto()
    Plus = enum.auto()
    Minus = enum.auto()
    LClick = enum.auto()
    RClick = enum.auto()
    Home = enum.auto()
    Capture = enum.auto()


class Hat(enum.IntEnum):
    Up = 0
    UpRight = 1
    Right = 2
    DownRight = 3
    Down = 4
    DownLeft = 5
    Left = 6
    UpLeft = 7
    Neutral = 8


@dataclasses.dataclass
class Stick:
    """
    top-left origin
    """

    NEUTRAL = 0x80

    x: int
    y: int


@dataclasses.dataclass
class _ControllerState:
    HEADER = 0xAB

    buttons: Button
    hat: Hat
    left_stick: Stick
    right_stick: Stick

    def to_bytes(self) -> bytes:
        return bytes(
            [
                self.HEADER,
                self.buttons & 0xFF,
                self.buttons >> 8,
                self.hat,
                self.left_stick.x,
                self.left_stick.y,
                self.right_stick.x,
                self.right_stick.y,
                0,
                0,
                0,
            ]
        )


def _get_neutral_bytes() -> bytes:
    """Generate neutral controller state bytes."""
    neutral_state = _ControllerState(
        Button(0),
        Hat.Neutral,
        Stick(Stick.NEUTRAL, Stick.NEUTRAL),
        Stick(Stick.NEUTRAL, Stick.NEUTRAL),
    )
    return neutral_state.to_bytes()


def _daemon(
    serial_queue: remote_game_console.protocols.Queue,
    args: Arguments,
    cancel: remote_game_console.protocols.Event,
) -> None:
    last_data = _get_neutral_bytes()
    last_send_time = time.time()

    with serial.Serial(args.port) as ser:
        while not cancel.is_set():
            try:
                data = serial_queue.get(timeout=0.1)
                ser.write(data)
                last_data = data
                last_send_time = time.time()
            except queue.Empty:
                if args.keep_alive_interval is not None:
                    current_time = time.time()
                    if current_time - last_send_time >= args.keep_alive_interval:
                        # Move the most neutral axis towards neutral to prevent sleep, then restore original value
                        data_list = list(last_data)
                        # rx, ry come first because right stick is generally used less frequently than left stick
                        most_neutral = min(
                            [
                                (6, abs(data_list[6] - Stick.NEUTRAL)),  # rx
                                (7, abs(data_list[7] - Stick.NEUTRAL)),  # ry
                                (4, abs(data_list[4] - Stick.NEUTRAL)),  # lx
                                (5, abs(data_list[5] - Stick.NEUTRAL)),  # ly
                            ],
                            key=lambda x: x[1],
                        )[0]
                        if data_list[most_neutral] > Stick.NEUTRAL:
                            data_list[most_neutral] -= 1
                        else:
                            data_list[most_neutral] += 1
                        ser.write(bytes(data_list))
                        ser.write(last_data)
                        last_send_time = current_time
                continue
            except Exception as e:
                print(f"Serial write error: {e}")
                break


class Controller:
    def __init__(self, serial_queue: remote_game_console.protocols.Queue):
        self.__queue = serial_queue
        self.__state = _ControllerState(
            Button(0),
            Hat.Neutral,
            Stick(Stick.NEUTRAL, Stick.NEUTRAL),
            Stick(Stick.NEUTRAL, Stick.NEUTRAL),
        )
        self.__send()

    def __send(self) -> None:
        self.__queue.put_nowait(self.__state.to_bytes())

    def press_button(self, btn: Button) -> None:
        self.__state.buttons = self.__state.buttons | btn
        self.__send()

    def release_button(self, btn: Button) -> None:
        self.__state.buttons = self.__state.buttons & ~btn
        self.__send()

    def update_hat(self, hat: Hat) -> None:
        self.__state.hat = hat
        self.__send()

    def update_left_stick(self, stick: Stick) -> None:
        self.__state.left_stick = stick
        self.__send()

    def update_right_stick(self, stick: Stick) -> None:
        self.__state.right_stick = stick
        self.__send()


def _test_serial(args: Arguments) -> None:
    with serial.Serial(args.port):
        pass


@contextlib.contextmanager
def start(
    args: Arguments, manager: remote_game_console.protocols.Manager
) -> typing.Generator[Controller, None, None]:
    _test_serial(args)

    serial_queue = manager.Queue(maxsize=16)
    cancel = manager.Event()
    daemon = multiprocessing.Process(
        target=_daemon,
        args=(serial_queue, args, cancel),
        daemon=True,
    )
    daemon.start()
    try:
        yield Controller(serial_queue)
    finally:
        cancel.set()
        try:
            daemon.join(timeout=1)
        except:  # noqa: E722 "Do not use bare `except`" from Ruff
            pass
