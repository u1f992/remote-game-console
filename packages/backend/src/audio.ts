import child_process from "node:child_process";
import { WebSocket } from "ws";

export function start(config: {
  ffmpeg?: string;
  format: string;
  device: string;
  channels: number;
  sampleRate: number;
  lowLatency?: boolean;
  maxBufferSize: number;
  bufferDuration?: number;
  bufferCapacity?: number;
  verbose?: boolean;
}) {
  const {
    ffmpeg,
    format,
    device,
    channels,
    sampleRate,
    lowLatency = true,
    maxBufferSize,
    bufferDuration = 10,
    bufferCapacity = 4,
    verbose,
  } = config;

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

  const CHUNK_SIZE = Math.floor(
    // s16le = 2 bytes per sample
    (sampleRate * channels * 2 * bufferDuration) / 1000,
  );
  const BUFFER_SIZE = CHUNK_SIZE * bufferCapacity;
  const audioBuffer = Buffer.allocUnsafe(BUFFER_SIZE);
  let bufferFilled = 0;

  (function start() {
    // NOTE: assert: process === null
    const bin = ffmpeg ?? "ffmpeg";
    const args =
      // prettier-ignore
      [
        // Low-latency options for live streaming (when enabled):
        ...(lowLatency ? [
          "-fflags", "nobuffer",       // Disable input buffering
          "-flags", "low_delay",       // Enable low-delay mode
          "-probesize", "32",          // Minimize stream analysis probe size
          "-analyzeduration", "0",     // Set stream analysis duration to zero
        ] : []),
        "-f", format,
        "-i", device,
        "-ac", `${channels}`,
        "-ar", `${sampleRate}`,
        "-f", "s16le",
        "-",
      ];
    console.log(`[audio] Starting FFmpeg process: ${bin} ${args.join(" ")}`);
    console.log(
      `[audio] Buffer duration: ${bufferDuration}ms, chunk size: ${CHUNK_SIZE} bytes, capacity: ${bufferCapacity} chunks (${BUFFER_SIZE} bytes)`,
    );

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
        bufferFilled = 0;

        // Attempts to restart unless intentionally terminated by SIGTERM/SIGKILL.
        if (signal !== "SIGTERM" && signal !== "SIGKILL") {
          console.log("[audio] Restarting FFmpeg process in 1 second...");
          setTimeout(() => {
            start();
          }, 1000);
        }
      });

    process!.stdout!.on("data", (data) => {
      let offset = 0;
      while (offset < data.length) {
        const remaining = data.length - offset;
        const available = audioBuffer.length - bufferFilled;

        // If buffer would overflow, discard old data
        if (remaining > available) {
          const bytesToDiscard = remaining - available;
          console.warn(
            `[audio] Buffer overflow: discarding ${bytesToDiscard} bytes of old audio data`,
          );
          // Shift buffer to make room, discarding oldest data
          audioBuffer.copy(audioBuffer, 0, bytesToDiscard, bufferFilled);
          bufferFilled -= bytesToDiscard;
        }

        // Copy data to buffer
        const bytesToCopy = Math.min(
          remaining,
          audioBuffer.length - bufferFilled,
        );
        data.copy(audioBuffer, bufferFilled, offset, offset + bytesToCopy);
        bufferFilled += bytesToCopy;
        offset += bytesToCopy;

        // Send chunks when we have enough buffered audio
        while (bufferFilled >= CHUNK_SIZE) {
          const chunk = audioBuffer.subarray(0, CHUNK_SIZE);

          clients.forEach((ws) => {
            sendToClient(ws, chunk);
          });

          // Shift remaining data to the beginning
          audioBuffer.copy(audioBuffer, 0, CHUNK_SIZE, bufferFilled);
          bufferFilled -= CHUNK_SIZE;
        }
      }
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
