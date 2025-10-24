import child_process from "node:child_process";
import { WebSocket } from "ws";

export function start(ffmpegConfig: {
  ffmpeg?: string;
  format: string;
  device: string;
  channels: number;
  sampleRate: number;
  maxBufferSize: number;
  verbose?: boolean;
}) {
  const {
    ffmpeg,
    format,
    device,
    channels,
    sampleRate,
    maxBufferSize,
    verbose,
  } = ffmpegConfig;

  const PENDING_CHUNK = Symbol("pendingChunk");
  const IS_BACKPRESSURED = Symbol("isBackpressured");

  function sendToClient(ws: WebSocket, chunk: Buffer) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Store the latest chunk
    // @ts-expect-error hidden property
    ws[PENDING_CHUNK] = chunk;

    // NOTE: initial state is falsy
    // @ts-expect-error hidden property
    if (ws[IS_BACKPRESSURED]) {
      // Still backpressured, skip sending (will retry on next chunk)
      return;
    }

    // Check bufferedAmount to detect backpressure
    if (ws.bufferedAmount > maxBufferSize) {
      // @ts-expect-error hidden property
      ws[IS_BACKPRESSURED] = true;
      // Skip this chunk, will retry when next chunk arrives
      return;
    }

    // Send the chunk
    ws.send(chunk);
    // @ts-expect-error hidden property
    ws[IS_BACKPRESSURED] = false;
    // Clear for GC
    // @ts-expect-error hidden property
    delete ws[PENDING_CHUNK];
  }

  const clients = new Set<WebSocket>();
  let process: child_process.ChildProcess | null = null;

  (function start() {
    // NOTE: assert: process === null
    const bin = ffmpeg ?? "ffmpeg";
    const args =
      // prettier-ignore
      [
        "-f", format,
        "-i", device,
        "-ac", `${channels}`,
        "-ar", `${sampleRate}`,
        "-f", "s16le",
        "-",
      ];
    console.log(`[audio] Starting FFmpeg process: ${bin} ${args.join(" ")}`);

    process = child_process
      .spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })
      .on("error", (err) => {
        throw err;
      })
      .on("exit", (code, signal) => {
        console.error(
          `[audio] FFmpeg exited with code ${code}, signal ${signal}`,
        );

        process?.removeAllListeners();
        process = null;

        // Attempts to restart unless intentionally terminated by SIGTERM/SIGKILL.
        if (signal !== "SIGTERM" && signal !== "SIGKILL") {
          console.log("[audio] Restarting FFmpeg process in 1 second...");
          setTimeout(() => {
            start();
          }, 1000);
        }
      });

    process!.stdout!.on("data", (data) => {
      clients.forEach((ws) => {
        sendToClient(ws, data);
      });
    });

    if (verbose) {
      process!.stderr!.on("data", (data) => {
        console.error(`[audio] ${data}`);
      });
    }
  })();

  return {
    getProcess() {
      return process;
    },
    getConfig() {
      return {
        channels,
        sampleRate,
      };
    },
    addClient(ws: WebSocket) {
      clients.add(ws);
    },
    removeClient(ws: WebSocket) {
      clients.delete(ws);
    },
  };
}
