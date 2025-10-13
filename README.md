# remote-game-console

Web-based remote control system for video, audio, and game controller streaming over HTTP.

## Features

- Video streaming (MJPEG)
- Audio streaming (HTTP streaming with Web Audio API)
- Game controller ([NX Macro Controller](https://blog.bzl-web.com/entry/2020/01/20/165719) compatible serial commands)

![](screenshot.png)

## Requirements

#### Ubuntu 24.04

```bash
$ sudo apt-get install -y portaudio19-dev  # for pyaudio
```

## Installation

```bash
$ uv sync
```

## Basic Usage

```bash
uv run python -m remote_game_console \
  --video-capture 0 \
  --width 800 \
  --height 600 \
  --serial-port /dev/ttyUSB0 \
  --keep-alive-interval 30 \
  --audio-device 1 \
  --audio-rate 48000 \
  --override-aspect-ratio-width 16 \
  --override-aspect-ratio-height 9
```

Access the web UI at `http://localhost:8080`

## Audio Latency Control

#### Low Latency

```bash
uv run python -m remote_game_console \
  --audio-device 1 \
  --audio-chunk 512 \
  --audio-queue-size 4 \
  --audio-buffer-size 3 \
  --audio-min-buffer 1 \
  # ... other options
```

#### Balanced, Default

```bash
uv run python -m remote_game_console \
  --audio-device 1 \
  --audio-chunk 1024 \
  --audio-queue-size 8 \
  --audio-buffer-size 5 \
  --audio-min-buffer 2 \
  # ... other options
```

#### High Stability

```bash
uv run python -m remote_game_console \
  --audio-device 1 \
  --audio-chunk 2048 \
  --audio-queue-size 15 \
  --audio-buffer-size 10 \
  --audio-min-buffer 5 \
  # ... other options
```

## List Available Audio Devices

```bash
uv run python -c "from remote_game_console.audio import list_devices; list_devices()"
```

## Fullscreen Display on Mobile

### Android

On Android browsers, you can use a bookmarklet to enable fullscreen mode. Create a bookmark with the following JavaScript code:

```javascript
javascript:document.documentElement.requestFullscreen()
```

<details>

1. Create a new bookmark in your browser
2. Set the URL to the JavaScript code above
3. Navigate to the web UI
4. Tap the bookmark to enter fullscreen mode

</details>

The [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) has limited support and may not work on all Android browsers.

### iOS

Due to very limited support for the Fullscreen API, there is currently no practical method to achieve fullscreen mode on iOS devices for this use case.

## Acknowledgments

- [yoannmoinet/nipplejs](https://github.com/yoannmoinet/nipplejs) by Yoann Moinet ([MIT license](remote_game_console/static/nipplejs-0.10.2/package/LICENSE))
- [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) ([OFL-1.1 license](remote_game_console/static/Noto_Sans/OFL.txt))
- Google Fonts Icons ([Apache-2.0 license](remote_game_console/static/icons/LICENSE-2.0.txt))
  - [Arrow Drop Up](https://fonts.google.com/icons?icon.query=arrow+&icon.size=24&icon.color=%231f1f1f&selected=Material+Symbols+Outlined:arrow_drop_up:FILL@0;wght@400;GRAD@0;opsz@24&icon.platform=web)
  - [Arrow Right](https://fonts.google.com/icons?icon.query=arrow+&icon.size=24&icon.color=%231f1f1f&selected=Material+Symbols+Outlined:arrow_right:FILL@0;wght@400;GRAD@0;opsz@24&icon.platform=web)
  - [Arrow Drop Down](https://fonts.google.com/icons?icon.query=arrow+&icon.size=24&icon.color=%231f1f1f&selected=Material+Symbols+Outlined:arrow_drop_down:FILL@0;wght@400;GRAD@0;opsz@24&icon.platform=web)
  - [Arrow Left](https://fonts.google.com/icons?icon.query=arrow+&icon.size=24&icon.color=%231f1f1f&selected=Material+Symbols+Outlined:arrow_left:FILL@0;wght@400;GRAD@0;opsz@24&icon.platform=web)
  - [Home](https://fonts.google.com/icons?icon.size=24&icon.color=%231f1f1f&selected=Material+Symbols+Outlined:home:FILL@0;wght@400;GRAD@0;opsz@24&icon.platform=web)
  - [Screen Record](https://fonts.google.com/icons?icon.query=record&icon.size=24&icon.color=%231f1f1f&selected=Material+Symbols+Outlined:screen_record:FILL@0;wght@400;GRAD@0;opsz@24&icon.platform=web)