import child_process from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";

function createFrameParser(
  boundary: string,
  maxFrameSize: number,
  onFrame: (frame: Buffer) => void,
) {
  let buffer = Buffer.alloc(0);
  const b = Buffer.from(`--${boundary}`);
  const CRLF = Buffer.from("\r\n");
  const CRLFCRLF = Buffer.from("\r\n\r\n");

  const isBoundaryAt = (buf: Buffer, pos: number) => {
    if (pos < 0) return false;
    const bof = pos === 0;
    const precededByCRLF =
      !bof && buf[pos - 2] === 0x0d && buf[pos - 1] === 0x0a;
    if (!bof && !precededByCRLF) return false;
    if (pos + b.length + 2 > buf.length) return false; // need space for boundary + CRLF
    if (!buf.subarray(pos, pos + b.length).equals(b)) return false;
    // boundary line must end with CRLF
    return buf[pos + b.length] === 0x0d && buf[pos + b.length + 1] === 0x0a;
  };

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      // find a boundary line at BOF or after CRLF
      let pos = 0;
      while (true) {
        pos = buffer.indexOf(b, pos);
        if (pos === -1) return; // need more data
        if (isBoundaryAt(buffer, pos)) break;
        pos += 1; // keep searching
      }

      const lineEnd = pos + b.length + CRLF.length; // after boundary CRLF
      if (buffer.length < lineEnd) return;

      // headers
      const headersEnd = buffer.indexOf(CRLFCRLF, lineEnd);
      if (headersEnd === -1) return;

      const headersRaw = buffer.subarray(lineEnd, headersEnd).toString("utf8");
      const m = headersRaw.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        // resync: drop this boundary line and continue
        buffer = buffer.subarray(lineEnd);
        continue;
      }
      const contentLength = parseInt(m[1]!, 10);
      if (!(contentLength >= 0 && contentLength <= maxFrameSize)) {
        buffer = buffer.subarray(lineEnd);
        continue;
      }

      const bodyStart = headersEnd + CRLFCRLF.length;
      const bodyEnd = bodyStart + contentLength;
      const tailCRLFEnd = bodyEnd + CRLF.length; // body must be followed by CRLF

      if (buffer.length < tailCRLFEnd) return; // incomplete

      // emit one full part: boundary line + headers + CRLFCRLF + body + CRLF
      const frame = buffer.subarray(pos, tailCRLFEnd);
      onFrame(frame);

      // consume
      buffer = buffer.subarray(tailCRLFEnd);
    }
  };
}

export function start(ffmpegConfig: {
  ffmpeg?: string;
  format: string;
  device: string;
  inputFormat?: string;
  size?: { width: number; height: number };
  fps?: number;
  maxFrameSize: number;
  verbose?: boolean;
}) {
  const {
    ffmpeg,
    format,
    device,
    inputFormat,
    size,
    fps,
    maxFrameSize,
    verbose,
  } = ffmpegConfig;

  const BOUNDARY = `ffmpeg-video-${crypto.randomUUID()}`;
  const PENDING_FRAME = Symbol("pendingFrame");
  const IS_BACKPRESSURED = Symbol("isBackpressured");

  function sendToClient(res: http.ServerResponse, frame: Buffer) {
    if (res.writableEnded || res.destroyed) {
      return;
    }

    // @ts-expect-error hidden property
    res[PENDING_FRAME] = frame;

    // NOTE: initial state is falsy
    // @ts-expect-error hidden property
    if (res[IS_BACKPRESSURED]) {
      return;
    }

    if (!res.write(frame)) {
      // @ts-expect-error hidden property
      res[IS_BACKPRESSURED] = true;
      res.once("drain", () => {
        if (res.writableEnded || res.destroyed) {
          return;
        }

        // @ts-expect-error hidden property
        res[IS_BACKPRESSURED] = false;
        // @ts-expect-error hidden property
        const pendingFrame = res[PENDING_FRAME] as Buffer | undefined;
        if (pendingFrame) {
          sendToClient(res, pendingFrame);
        }
      });
    } else {
      // Clear for GC
      // @ts-expect-error hidden property
      delete res[PENDING_FRAME];
    }
  }

  const clients = new Set<http.ServerResponse>();
  let process: child_process.ChildProcess | null = null;

  (function start() {
    // NOTE: assert: process === null
    const bin = ffmpeg ?? "ffmpeg";
    const args =
      // prettier-ignore
      [
        "-f", format,
        ...(inputFormat ? [format === "v4l2" ? "-input_format" : "-pixel_format", inputFormat] : []),
        ...(size ? ["-video_size", `${size.width}x${size.height}`] : []),
        ...(typeof fps !== "undefined" ? ["-framerate", `${fps}`] : []),
        "-i", device,
        "-an", // no audio
        ...(inputFormat === "mjpeg" && format === "v4l2" ? ["-codec:v", "copy"] : []),
        "-f", "mpjpeg",
        "-boundary_tag", BOUNDARY,
        "-",
      ];
    console.log(`[video] Starting FFmpeg process: ${bin} ${args.join(" ")}`);

    process = child_process
      .spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })
      .on("error", (err) => {
        throw err;
      })
      .on("exit", (code, signal) => {
        console.error(
          `[video] FFmpeg exited with code ${code}, signal ${signal}`,
        );

        process?.removeAllListeners();
        process = null;

        // Attempts to restart unless intentionally terminated by SIGTERM/SIGKILL.
        if (signal !== "SIGTERM" && signal !== "SIGKILL") {
          console.log("[video] Restarting FFmpeg process in 1 second...");
          setTimeout(() => {
            start();
          }, 1000);
        }
      });

    process!.stdout!.on(
      "data",
      createFrameParser(BOUNDARY, maxFrameSize, (frame: Buffer) => {
        clients.forEach((res) => {
          sendToClient(res, frame);
        });
      }),
    );

    if (verbose) {
      process!.stderr!.on("data", (data) => {
        console.error(`[video] ${data}`);
      });
    }
  })();

  return {
    getProcess() {
      return process;
    },
    addClient(res: http.ServerResponse) {
      res.writeHead(200, {
        "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.flushHeaders();
      clients.add(res);
    },
    removeClient(res: http.ServerResponse) {
      clients.delete(res);
    },
  };
}
