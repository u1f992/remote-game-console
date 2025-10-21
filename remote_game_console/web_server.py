import argparse
import dataclasses
import logging
import pathlib
import typing

import cv2
import flask

import remote_game_console.audio
import remote_game_console.serial_port
import remote_game_console.video


def add_arguments(parser: argparse.ArgumentParser) -> None:
    args: dict[str, dict[str, typing.Any]] = {
        "--port": {
            "type": int,
            "default": 8080,
            "help": "default: 8080",
        },
        "--override-aspect-ratio-width": {
            "type": float,
            "help": "override aspect ratio width (both width and height must be specified)",
        },
        "--override-aspect-ratio-height": {
            "type": float,
            "help": "override aspect ratio height (both width and height must be specified)",
        },
        "--audio-buffer-size": {
            "type": int,
            "default": 5,
            "help": "frontend audio buffer size, affects latency and stability. default: 5",
        },
        "--audio-min-buffer": {
            "type": int,
            "default": 2,
            "help": "minimum buffer before playback starts. default: 2",
        },
    }
    for name, kwargs in args.items():
        parser.add_argument(name, **kwargs)


@dataclasses.dataclass(frozen=True)
class Arguments:
    port: int
    override_aspect_ratio: tuple[float, float] | None
    audio_buffer_size: int
    audio_min_buffer: int


def validate(args: argparse.Namespace) -> Arguments | None:
    if not isinstance(args.port, int):
        return None
    port = max(1, min(65535, args.port))

    # Both width and height must be specified together, or neither
    has_width = args.override_aspect_ratio_width is not None
    has_height = args.override_aspect_ratio_height is not None

    if has_width != has_height:
        return None

    override_aspect_ratio: tuple[float, float] | None = None
    if has_width and has_height:
        if not isinstance(args.override_aspect_ratio_width, float) or not isinstance(args.override_aspect_ratio_height, float):
            return None
        width = max(0.0, args.override_aspect_ratio_width)
        height = max(0.0, args.override_aspect_ratio_height)
        if width <= 0 or height <= 0:
            return None
        override_aspect_ratio = (width, height)

    if not isinstance(args.audio_buffer_size, int):
        return None
    audio_buffer_size = max(1, args.audio_buffer_size)

    if not isinstance(args.audio_min_buffer, int):
        return None
    audio_min_buffer = max(1, args.audio_min_buffer)

    return Arguments(port, override_aspect_ratio, audio_buffer_size, audio_min_buffer)


def start(
    args: Arguments,
    video: remote_game_console.video.Video,
    audio: remote_game_console.audio.AudioManager,
    controller: remote_game_console.serial_port.Controller,
) -> None:
    static_folder = pathlib.Path(__file__).parent / "static"
    app = flask.Flask(
        __name__, static_folder=str(static_folder), static_url_path="/static"
    )

    # Filter out audio_chunk logs
    class AudioChunkFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            return "/audio_chunk" not in record.getMessage()

    logging.getLogger("werkzeug").addFilter(AudioChunkFilter())

    @app.route("/")
    def _index() -> flask.Response:
        return flask.send_from_directory(str(static_folder), "index.html")

    def _generate_frames() -> typing.Generator[bytes, None, None]:
        while True:
            with video.get() as mat:
                _, buffer = cv2.imencode(".jpg", mat)
                frame_bytes = buffer.tobytes()

                yield (
                    b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )

    @app.route("/video_feed")
    def _video_feed() -> flask.Response:
        return flask.Response(
            _generate_frames(), mimetype="multipart/x-mixed-replace; boundary=frame"
        )

    @app.route("/audio_chunk")
    def _audio_chunk() -> flask.Response:
        client = audio.create_client()
        try:
            data = client.get()
            return flask.Response(data, mimetype="application/octet-stream")
        except TimeoutError:
            return flask.Response(b"", mimetype="application/octet-stream", status=204)
        finally:
            audio.remove_client(client)

    def _generate_audio() -> typing.Generator[bytes, None, None]:
        """Stream audio chunks continuously over a single HTTP connection."""
        client = audio.create_client()
        try:
            while True:
                try:
                    data = client.get()
                    # Send chunk size (4 bytes, big-endian) followed by data
                    chunk_size = len(data)
                    yield chunk_size.to_bytes(4, byteorder='big') + data
                except TimeoutError:
                    # Send zero-length chunk on timeout
                    yield (0).to_bytes(4, byteorder='big')
        finally:
            audio.remove_client(client)

    @app.route("/audio_stream")
    def _audio_stream() -> flask.Response:
        return flask.Response(
            _generate_audio(), mimetype="application/octet-stream"
        )

    @app.route("/audio_config")
    def _audio_config() -> flask.Response:
        config = {
            "sampleRate": audio.rate,
            "channels": audio.channels,
            "sampleWidth": audio.sample_width,
            "gain": audio.gain,
            "bufferSize": args.audio_buffer_size,
            "minBuffer": args.audio_min_buffer,
        }
        return flask.jsonify(config)

    @app.route("/video_config")
    def _video_config() -> flask.Response:
        config = {}
        if args.override_aspect_ratio is not None:
            width, height = args.override_aspect_ratio
            config["overrideAspectRatio"] = {"width": width, "height": height}
        return flask.jsonify(config)

    @app.route("/button/press/<button_name>", methods=["POST"])
    def _button_press(button_name: str) -> flask.Response:
        try:
            button = remote_game_console.serial_port.Button[button_name]
            controller.press_button(button)
            return flask.Response("OK", status=200)
        except KeyError:
            return flask.Response("Invalid button name", status=400)

    @app.route("/button/release/<button_name>", methods=["POST"])
    def _button_release(button_name: str) -> flask.Response:
        try:
            button = remote_game_console.serial_port.Button[button_name]
            controller.release_button(button)
            return flask.Response("OK", status=200)
        except KeyError:
            return flask.Response("Invalid button name", status=400)

    @app.route("/hat/<hat_direction>", methods=["POST"])
    def _hat_update(hat_direction: str) -> flask.Response:
        try:
            hat = remote_game_console.serial_port.Hat[hat_direction]
            controller.update_hat(hat)
            return flask.Response("OK", status=200)
        except KeyError:
            return flask.Response("Invalid hat direction", status=400)

    @app.route("/stick/left/<int:x>/<int:y>", methods=["POST"])
    def _left_stick_update(x: int, y: int) -> flask.Response:
        try:
            stick = remote_game_console.serial_port.Stick(x, y)
            controller.update_left_stick(stick)
            return flask.Response("OK", status=200)
        except Exception as e:
            return flask.Response(f"Error: {str(e)}", status=400)

    @app.route("/stick/right/<int:x>/<int:y>", methods=["POST"])
    def _right_stick_update(x: int, y: int) -> flask.Response:
        try:
            stick = remote_game_console.serial_port.Stick(x, y)
            controller.update_right_stick(stick)
            return flask.Response("OK", status=200)
        except Exception as e:
            return flask.Response(f"Error: {str(e)}", status=400)

    app.run(host="0.0.0.0", port=args.port, threaded=True)
