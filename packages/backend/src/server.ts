import express from "express";
import http from "node:http";
import path from "node:path";
import url from "node:url";
import { WebSocketServer } from "ws";

import { start as startAudio } from "./audio.js";
import { start as startVideo } from "./video.js";
import { Button, Hat, start as startController } from "./controller.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const video = startVideo({
  format: "v4l2",
  device: "/dev/video0",
  // $ ffmpeg -f v4l2 -list_formats all -i /dev/video0
  // Compressed:       mjpeg :          Motion-JPEG : ... 640x480
  inputFormat: "mjpeg",
  size: { width: 640, height: 480 },
  fps: 20,
  maxFrameSize: 50 * 1024 * 1024, // 50MB
  verbose: false,
});
const audio = startAudio({
  // ALSA:
  //   $ ffmpeg -sources alsa
  //   $ arecord -l
  // PulseAudio:
  //   $ ffmpeg -sources pulse
  format: "alsa",
  device: "hw:CARD=ReceiverSolid,DEV=0",
  channels: 1,
  sampleRate: 48000,
  maxBufferSize: 256 * 1024, // 256KB
  verbose: false,
});
const controller = startController({
  path: "/dev/ttyUSB0",
  baudRate: 9600,
  verbose: false,
});

app.get("/video", (req, res) => {
  console.log("[video] Client connected");
  video.addClient(res);
  req.on("close", () => {
    console.log("[video] Client disconnected");
    video.removeClient(res);
  });
});

app.get("/audio/config", (_, res) => {
  res.json(audio.getConfig());
});

const server = http.createServer(app);

const audioWss = new WebSocketServer({ noServer: true });
const controllerWss = new WebSocketServer({ noServer: true });

// https://github.com/websockets/ws/tree/8.18.3?tab=readme-ov-file#multiple-servers-sharing-a-single-https-server
server.on("upgrade", (request, socket, head) => {
  // Base URL is only used for pathname extraction and is not actually used
  // (any valid URL like "ws://localhost" or "wss://base.url" works)
  const { pathname } = new URL(request.url!, "ws://localhost");

  if (pathname === "/audio") {
    audioWss.handleUpgrade(request, socket, head, (ws) => {
      audioWss.emit("connection", ws, request);
    });
  } else if (pathname === "/controller") {
    controllerWss.handleUpgrade(request, socket, head, (ws) => {
      controllerWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

audioWss.on("connection", (ws) => {
  console.log("[audio] Client connected");
  audio.addClient(ws);
  ws.on("close", () => {
    console.log("[audio] Client disconnected");
    audio.removeClient(ws);
  });
});

controllerWss.on("connection", (ws) => {
  console.log("[controller] Client connected");

  ws.on("close", () => {
    console.log("[controller] Client disconnected");
  });

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      console.error("[controller] Failed to parse message:", err);
      return;
    }

    if (message.type === "button") {
      // @ts-expect-error may undefined
      const button = Button[message.button];
      if (button) {
        if (message.action === "press") {
          controller.pressButton(button);
        } else if (message.action === "release") {
          controller.releaseButton(button);
        }
      }
    } else if (message.type === "hat") {
      // @ts-expect-error may undefined
      const hat = Hat[message.direction];
      if (typeof hat !== "undefined") {
        controller.updateHat(hat);
      }
    } else if (message.type === "stick") {
      if (message.stick === "left") {
        controller.updateLeftStick({ x: message.x, y: message.y });
      } else if (message.stick === "right") {
        controller.updateRightStick({ x: message.x, y: message.y });
      }
    }
  });
});

server.listen(8080, () => {
  console.log("[server] HTTP server listening on port 8080");
  console.log("[server] WebSocket endpoints: /audio, /controller");
});

const shutdown = () => {
  console.log("\n[server] Shutting down gracefully");
  video.getProcess()?.kill("SIGTERM");
  audio.getProcess()?.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
