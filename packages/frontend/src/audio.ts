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
    console.log(
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
  const audio = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/audio`,
  );
  audio.binaryType = "arraybuffer";
  audio.addEventListener("open", async () => {
    const serverConfig = await fetchAudioServerConfig();
    const context = new AudioContext({
      sampleRate: serverConfig.sampleRate,
    });
    context.resume();
    // Resume audio context on user interaction (required by browser autoplay policy)
    document.addEventListener("click", () => {
      context.resume();
    });

    let playTime = context.currentTime;
    audio.addEventListener("message", ({ data }) => {
      playTime =
        context.state === "suspended"
          ? context.currentTime
          : playChunk(context, serverConfig, clientConfig, data, playTime);
    });
  });
}
