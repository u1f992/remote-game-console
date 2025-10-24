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
  video.addClient(res);
  req.on("close", () => {
    video.removeClient(res);
  });
});

app.get("/audio/config", (_, res) => {
  res.json(audio.getConfig());
});

app.post("/button/press/:buttonName", (req, res) => {
  // @ts-expect-error may undefined
  const button = Button[req.params.buttonName];
  if (button) {
    controller.pressButton(button);
    res.status(200).end();
  } else {
    res.status(400).end();
  }
});

app.post("/button/release/:buttonName", (req, res) => {
  // @ts-expect-error may undefined
  const button = Button[req.params.buttonName];
  if (button) {
    controller.releaseButton(button);
    res.status(200).end();
  } else {
    res.status(400).end();
  }
});

app.post("/hat/:hatDirection", (req, res) => {
  // @ts-expect-error may undefined
  const hat = Hat[req.params.hatDirection];
  if (typeof hat !== "undefined") {
    controller.updateHat(hat);
    res.status(200).end();
  } else {
    res.status(400).end();
  }
});

app.post("/stick/left/:x/:y", (req, res) => {
  controller.updateLeftStick({
    x: parseFloat(req.params.x),
    y: parseFloat(req.params.y),
  });
  res.status(200).end();
});

app.post("/stick/right/:x/:y", (req, res) => {
  controller.updateRightStick({
    x: parseFloat(req.params.x),
    y: parseFloat(req.params.y),
  });
  res.status(200).end();
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
