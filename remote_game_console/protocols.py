import typing


class Event(typing.Protocol):
    """
    mypy identifies `multiprocessing.Manager().Event()` as `threading.Event`,
    but the correct type is actually `multiprocessing.synchronize.Event`.
    """

    def clear(self) -> None:
        raise NotImplementedError()

    def is_set(self) -> bool:
        raise NotImplementedError()

    def set(self) -> None:
        raise NotImplementedError()

    def wait(self, timeout: float | None = None) -> bool:
        raise NotImplementedError()


class Queue(typing.Protocol):
    """
    mypy identifies `multiprocessing.Manager().Queue()` as `queue.Queue[Any]`,
    but the correct type is actually `multiprocessing.queues.Queue[bytes]`.
    """

    def get(self, block: bool = True, timeout: float | None = None) -> bytes:
        raise NotImplementedError()

    def put_nowait(self, item: bytes) -> None:
        raise NotImplementedError()


class Manager(typing.Protocol):
    """
    Protocol for multiprocessing.Manager to enable dependency injection.
    """

    def Event(self) -> Event:
        raise NotImplementedError()

    def Queue(self, maxsize: int = 0) -> Queue:
        raise NotImplementedError()
