import argparse
import logging
import multiprocessing
import sys

import remote_game_console.audio
import remote_game_console.serial_port
import remote_game_console.video
import remote_game_console.web_server


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")

    if "--list-audio-devices" in sys.argv:
        remote_game_console.audio.list_devices()
        exit(0)

    parser = argparse.ArgumentParser()
    remote_game_console.video.add_arguments(parser)
    remote_game_console.audio.add_arguments(parser)
    remote_game_console.serial_port.add_arguments(parser)
    remote_game_console.web_server.add_arguments(parser)
    args = parser.parse_args()
    camera_args = remote_game_console.video.validate(args)
    audio_args = remote_game_console.audio.validate(args)
    serial_port_args = remote_game_console.serial_port.validate(args)
    web_server_args = remote_game_console.web_server.validate(args)
    if (
        camera_args is None
        or audio_args is None
        or serial_port_args is None
        or web_server_args is None
    ):
        parser.print_help()
        exit(0)

    with (
        multiprocessing.Manager() as manager,
        remote_game_console.video.start(camera_args, manager) as camera,
        remote_game_console.audio.start(audio_args, manager) as audio_stream,
        remote_game_console.serial_port.start(serial_port_args, manager) as controller,
    ):
        print(f"Starting web server on http://0.0.0.0:{web_server_args.port}")
        remote_game_console.web_server.start(
            web_server_args, camera, audio_stream, controller
        )
