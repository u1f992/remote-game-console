import express from "express";
import http from "node:http";
import path from "node:path";
import url from "node:url";
import { WebSocketServer } from "ws";

import { start as startAudio } from "./audio.js";
import { start as startVideo } from "./video.js";

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
  fps: 30,
  maxFrameSize: 50 * 1024 * 1024, // 50MB
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
  sampleRate: 44100,
  maxBufferSize: 256 * 1024, // 256KB
});

app.get("/video", (req, res) => {
  video.addClient(res);
  req.on("close", () => {
    video.removeClient(res);
  });
});

app.get("/audio/config", (_, res) => {
  res.json(audio.getConfig());
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/audio" });
wss.on("connection", (ws) => {
  audio.addClient(ws);
  ws.on("close", () => {
    audio.removeClient(ws);
  });
});

server.listen(8080);

const shutdown = () => {
  console.log("\n[server] Shutting down gracefully");
  video.getProcess()?.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
