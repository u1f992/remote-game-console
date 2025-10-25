import { log, logWarn, logError } from "./log.js";

type AudioServerConfig = { channels: number; sampleRate: number };
type AudioClientConfig = { targetLatency: number; maxLatency: number };

async function fetchAudioServerConfig() {
  const response = await fetch("/audio/config");
  const shouldAudioConfig = await response.json();
  if (
    typeof shouldAudioConfig.channels !== "number" ||
    typeof shouldAudioConfig.sampleRate !== "number"
  ) {
    throw new Error(
      `invalid audioConfig: ${JSON.stringify(shouldAudioConfig)}`,
    );
  }
  return shouldAudioConfig as AudioServerConfig;
}

function playChunk(
  context: AudioContext,
  { channels, sampleRate }: AudioServerConfig,
  { targetLatency, maxLatency }: AudioClientConfig,
  buffer: ArrayBuffer,
  playTime: number,
) {
  const int16Array = new Int16Array(buffer);
  const numFrames = int16Array.length / channels;

  const audioBuffer = context.createBuffer(channels, numFrames, sampleRate);

  // Deinterleave and convert Int16 PCM to Float32
  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numFrames; i++) {
      channelData[i] = int16Array[i * channels + ch]! / 32768.0;
    }
  }

  const currentTime = context.currentTime;

  // If we're falling behind or too far ahead, reset to current time + target latency
  const latency = playTime - currentTime;
  let correctedPlayTime = playTime;
  if (correctedPlayTime < currentTime || latency > maxLatency) {
    correctedPlayTime = currentTime + targetLatency;
    logWarn(
      `[audio] Latency reset: was ${(latency * 1000).toFixed(0)}ms, now ${(targetLatency * 1000).toFixed(0)}ms`,
    );
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  source.start(correctedPlayTime);

  const nextPlayTime = correctedPlayTime + audioBuffer.duration;
  return nextPlayTime;
}

export function start(clientConfig: AudioClientConfig) {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let context: AudioContext | null = null;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/audio`;

  (function connect() {
    log("[audio] Connecting to:", wsUrl);
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", async () => {
      log("[audio] WebSocket connected");

      try {
        const serverConfig = await fetchAudioServerConfig();
        context = new AudioContext({
          sampleRate: serverConfig.sampleRate,
        });
        context.resume();

        // Resume audio context on user interaction (required by browser autoplay policy)
        document.addEventListener("click", () => {
          context?.resume();
        });

        let playTime = context.currentTime;
        ws!.addEventListener("message", ({ data }) => {
          if (context) {
            playTime =
              context.state === "suspended"
                ? context.currentTime
                : playChunk(
                    context,
                    serverConfig,
                    clientConfig,
                    data,
                    playTime,
                  );
          }
        });
      } catch (err) {
        logError("[audio] Failed to initialize audio context:", err);
      }
    });

    ws.addEventListener("close", (event) => {
      log("[audio] WebSocket closed:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      ws = null;
      // Close audio context on disconnect
      context?.close();
      context = null;
      reconnectTimer = window.setTimeout(connect, 1000);
    });

    ws.addEventListener("error", (err) => {
      logError("[audio] WebSocket error:", err);
    });
  })();

  return {
    close() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (context) {
        context.close();
        context = null;
      }
      ws?.close();
      ws = null;
    },
  };
}
