// @ts-check
export {}; // ensure ESM

const params = new URLSearchParams(window.location.search);
const audioTargetLatency = params.get("audioTargetLatency");
const audioMaxLatency = params.get("audioMaxLatency");

if (!audioTargetLatency || !audioMaxLatency) {
  const defaultParams = new URLSearchParams({
    audioTargetLatency: "50",
    audioMaxLatency: "200",
  });
  window.location.href = `${window.location.pathname}?${defaultParams.toString()}`;
}

const AUDIO_TARGET_LATENCY = parseFloat(audioTargetLatency ?? "50") / 1000;
const AUDIO_MAX_LATENCY = parseFloat(audioMaxLatency ?? "200") / 1000;

type AudioConfig = { channels: number; sampleRate: number };
async function fetchAudioConfig() {
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
  return shouldAudioConfig as AudioConfig;
}

function playChunk(
  context: AudioContext,
  { channels, sampleRate }: AudioConfig,
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
  if (correctedPlayTime < currentTime || latency > AUDIO_MAX_LATENCY) {
    correctedPlayTime = currentTime + AUDIO_TARGET_LATENCY;
    console.log(
      `[audio] Latency reset: was ${(latency * 1000).toFixed(0)}ms, now ${(AUDIO_TARGET_LATENCY * 1000).toFixed(0)}ms`,
    );
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  source.start(correctedPlayTime);

  const nextPlayTime = correctedPlayTime + audioBuffer.duration;
  return nextPlayTime;
}

const audio = new WebSocket(
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/audio`,
);
audio.binaryType = "arraybuffer";
audio.addEventListener("open", async () => {
  const config = await fetchAudioConfig();
  const context = new AudioContext({
    sampleRate: config.sampleRate,
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
        : playChunk(context, config, data, playTime);
  });
});
