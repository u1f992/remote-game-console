function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
}

setViewportHeight();
window.addEventListener("resize", setViewportHeight);
window.addEventListener("orientationchange", setViewportHeight);

// Prevent long-press context menu on video stream
const videoStream = document.getElementById("video-stream");
videoStream.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Apply video aspect ratio override if configured
let overrideAspectRatio = null;

async function applyVideoConfig() {
  try {
    const response = await fetch("/video_config");
    const config = await response.json();

    if (config.overrideAspectRatio) {
      overrideAspectRatio = config.overrideAspectRatio;
      updateVideoSize();
    }
  } catch (err) {
    console.error("Failed to load video config:", err);
  }
}

function updateVideoSize() {
  if (!overrideAspectRatio) return;

  const { width, height } = overrideAspectRatio;
  const aspectRatio = width / height;

  const container = document.getElementById("video-container");
  const videoStream = document.getElementById("video-stream");

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  let videoWidth, videoHeight;

  // Calculate size to fit container with target aspect ratio
  if (containerWidth / containerHeight > aspectRatio) {
    // Container is wider than target aspect ratio
    videoHeight = containerHeight;
    videoWidth = videoHeight * aspectRatio;
  } else {
    // Container is taller than target aspect ratio
    videoWidth = containerWidth;
    videoHeight = videoWidth / aspectRatio;
  }

  videoStream.style.width = `${videoWidth}px`;
  videoStream.style.height = `${videoHeight}px`;
}

applyVideoConfig();

window.addEventListener("resize", updateVideoSize);
window.addEventListener("orientationchange", updateVideoSize);

// Check if audio is disabled via query parameter
function isAudioDisabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("noaudio") === "1";
}

// Web Audio API for streaming
let audioContext = null;
let audioConfig = null;
let isPlaying = false;
let nextPlayTime = 0;
let gainNode = null;

async function initAudio() {
  if (audioContext) return;

  // Get audio configuration
  const configResponse = await fetch("/audio_config");
  audioConfig = await configResponse.json();
  // console.log("Audio config:", audioConfig);

  // Create audio context
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // console.log("AudioContext state:", audioContext.state);

  // Resume audio context if suspended
  if (audioContext.state === "suspended") {
    await audioContext.resume();
    // console.log("AudioContext resumed, new state:", audioContext.state);
  }

  // Create gain node to control volume
  gainNode = audioContext.createGain();
  gainNode.gain.value = audioConfig.gain;
  gainNode.connect(audioContext.destination);
  // console.log("Gain node created with gain:", gainNode.gain.value);

  // Initialize play time
  nextPlayTime = audioContext.currentTime;

  isPlaying = true;
  streamAudio();
}

async function streamAudio() {
  const audioBufferQueue = [];
  const TARGET_BUFFER_SIZE = audioConfig.bufferSize || 5;
  const MIN_BUFFER_BEFORE_PLAY = audioConfig.minBuffer || 2;
  let hasStartedPlayback = false;

  // Stream audio chunks continuously over a single HTTP connection
  const fetchLoop = async () => {
    try {
      const response = await fetch("/audio_stream");
      if (!response.body) {
        console.error("Response body is null");
        return;
      }

      const reader = response.body.getReader();
      let buffer = new Uint8Array(0);

      while (isPlaying) {
        if (audioBufferQueue.length >= TARGET_BUFFER_SIZE) {
          // Buffer is full, wait before reading more
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }

        // Read chunk size (4 bytes)
        while (buffer.length < 4) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("Audio stream ended");
            return;
          }
          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;
        }

        // Extract chunk size
        const chunkSize =
          (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
        buffer = buffer.slice(4);

        if (chunkSize === 0) {
          // Empty chunk (timeout), continue
          continue;
        }

        // Read chunk data
        while (buffer.length < chunkSize) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("Audio stream ended unexpectedly");
            return;
          }
          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;
        }

        // Extract chunk data
        const chunkData = buffer.slice(0, chunkSize);
        buffer = buffer.slice(chunkSize);

        // Convert PCM data to AudioBuffer
        const int16Array = new Int16Array(chunkData.buffer);
        const float32Array = new Float32Array(int16Array.length);

        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }

        const samplesPerChannel = float32Array.length / audioConfig.channels;
        const audioBuffer = audioContext.createBuffer(
          audioConfig.channels,
          samplesPerChannel,
          audioConfig.sampleRate
        );

        // Fill audio buffer channels
        if (audioConfig.channels === 1) {
          const channelData = audioBuffer.getChannelData(0);
          for (let i = 0; i < samplesPerChannel; i++) {
            channelData[i] = float32Array[i];
          }
        } else {
          for (let channel = 0; channel < audioConfig.channels; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            for (let i = 0; i < samplesPerChannel; i++) {
              channelData[i] = float32Array[i * audioConfig.channels + channel];
            }
          }
        }

        audioBufferQueue.push(audioBuffer);
      }
    } catch (err) {
      console.error("Audio stream error:", err);
      if (isPlaying) {
        // Retry connection after delay
        await new Promise((resolve) => setTimeout(resolve, 1000));
        fetchLoop();
      }
    }
  };

  // Start streaming
  fetchLoop();

  // Play audio chunks
  while (isPlaying) {
    // Wait for initial buffer before starting playback
    if (
      !hasStartedPlayback &&
      audioBufferQueue.length < MIN_BUFFER_BEFORE_PLAY
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    hasStartedPlayback = true;

    if (audioBufferQueue.length === 0) {
      // Buffer underrun - wait for data and reset playback timing
      console.warn("Audio buffer underrun - waiting for data");
      hasStartedPlayback = false;
      await new Promise((resolve) => setTimeout(resolve, 30));
      continue;
    }

    const audioBuffer = audioBufferQueue.shift();

    // Schedule audio buffer for playback
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    // If we're behind schedule, reset to current time plus small offset
    if (nextPlayTime < audioContext.currentTime) {
      nextPlayTime = audioContext.currentTime + 0.03; // 30ms safety margin
    }

    source.start(nextPlayTime);

    // Update next play time
    nextPlayTime += audioBuffer.duration;

    // Minimal delay before processing next chunk
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

// Start audio on user interaction
const startAudio = () => {
  initAudio().catch((err) => {
    console.error("Audio init failed:", err);
  });
  document.removeEventListener("click", startAudio);
  document.removeEventListener("touchstart", startAudio);
};

if (isAudioDisabled()) {
  console.log("Audio disabled by query parameter");
} else {
  document.addEventListener("click", startAudio);
  document.addEventListener("touchstart", startAudio);
}

// Button mappings
const buttonMap = {
  "btn-y": "Y",
  "btn-b": "B",
  "btn-a": "A",
  "btn-x": "X",
  "btn-l": "L",
  "btn-r": "R",
  "btn-zl": "ZL",
  "btn-zr": "ZR",
  "btn-plus": "Plus",
  "btn-minus": "Minus",
  "btn-lclick": "LClick",
  "btn-rclick": "RClick",
  "btn-home": "Home",
  "btn-capture": "Capture",
};

// D-pad (Hat) state tracking
const dpadState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

function getHatValue() {
  const { up, down, left, right } = dpadState;

  if (up && right) return "UpRight";
  if (up && left) return "UpLeft";
  if (down && right) return "DownRight";
  if (down && left) return "DownLeft";
  if (up) return "Up";
  if (down) return "Down";
  if (left) return "Left";
  if (right) return "Right";
  return "Neutral";
}

async function updateHat() {
  const hatValue = getHatValue();
  try {
    await fetch(`/hat/${hatValue}`, { method: "POST" });
  } catch (err) {
    console.error("Hat update error:", err);
  }
}

// Setup button event handlers
Object.keys(buttonMap).forEach((btnId) => {
  const button = document.getElementById(btnId);
  const buttonName = buttonMap[btnId];

  button.addEventListener("mousedown", async () => {
    try {
      await fetch(`/button/press/${buttonName}`, { method: "POST" });
    } catch (err) {
      console.error("Button press error:", err);
    }
  });

  button.addEventListener("mouseup", async () => {
    try {
      await fetch(`/button/release/${buttonName}`, { method: "POST" });
    } catch (err) {
      console.error("Button release error:", err);
    }
  });

  button.addEventListener("touchstart", async (e) => {
    e.preventDefault();
    button.classList.add("active");
    try {
      await fetch(`/button/press/${buttonName}`, { method: "POST" });
    } catch (err) {
      console.error("Button press error:", err);
    }
  });

  button.addEventListener("touchend", async (e) => {
    e.preventDefault();
    button.classList.remove("active");
    try {
      await fetch(`/button/release/${buttonName}`, { method: "POST" });
    } catch (err) {
      console.error("Button release error:", err);
    }
  });
});

// D-pad button mappings
const dpadButtons = {
  "btn-up": "up",
  "btn-down": "down",
  "btn-left": "left",
  "btn-right": "right",
};

// Setup D-pad event handlers
Object.keys(dpadButtons).forEach((btnId) => {
  const button = document.getElementById(btnId);
  const direction = dpadButtons[btnId];

  button.addEventListener("mousedown", async () => {
    dpadState[direction] = true;
    await updateHat();
  });

  button.addEventListener("mouseup", async () => {
    dpadState[direction] = false;
    await updateHat();
  });

  button.addEventListener("touchstart", async (e) => {
    e.preventDefault();
    button.classList.add("active");
    dpadState[direction] = true;
    await updateHat();
  });

  button.addEventListener("touchend", async (e) => {
    e.preventDefault();
    button.classList.remove("active");
    dpadState[direction] = false;
    await updateHat();
  });
});

// Joystick setup
const joystickSize = 125;
document.documentElement.style.setProperty(
  "--joystick-size-value",
  joystickSize
);

const leftZone = document.getElementById("left-joystick");
const rightZone = document.getElementById("right-joystick");

const leftJoystick = nipplejs.create({
  zone: leftZone,
  size: joystickSize,
  mode: "static",
  position: { top: "50%", left: "50%" },
});

const rightJoystick = nipplejs.create({
  zone: rightZone,
  size: joystickSize,
  mode: "static",
  position: { top: "50%", left: "50%" },
});

// Workaround for nipplejs reload bug:
// Without this, reloading the page causes joystick to freeze (every input sends 128/128)
// Reproduced on Chrome 141.0.7390.76, Ubuntu 24.04
window.dispatchEvent(new Event("resize"));

function convertToStickValue(data) {
  if (!data.distance || !data.angle) {
    return { x: 128, y: 128 };
  }

  // nipplejs distance ranges from 0 to size/2 (typically 50 for a 100px zone)
  const normalizedDistance = Math.min(
    data.distance / (data.instance.options.size / 2),
    1.0
  );
  const relX = Math.cos(data.angle.radian) * normalizedDistance;
  const relY = Math.sin(data.angle.radian) * normalizedDistance;

  // top-left origin
  const stickX = Math.round(128 + relX * 128);
  const stickY = Math.round(128 - relY * 128);

  return {
    x: Math.max(0, Math.min(255, stickX)),
    y: Math.max(0, Math.min(255, stickY)),
  };
}

// Store current stick positions
let leftStick = { x: 128, y: 128 };
let rightStick = { x: 128, y: 128 };
let lastLeftStick = { x: 128, y: 128 };
let lastRightStick = { x: 128, y: 128 };

// Update stick positions on move (don't fetch immediately)
leftJoystick.on("move", (evt, data) => {
  leftStick = convertToStickValue(data);
});

leftJoystick.on("end", async () => {
  leftStick = { x: 128, y: 128 };
  // Immediately send neutral position to ensure it's not missed
  await fetch(`/stick/left/128/128`, { method: "POST" });
  lastLeftStick = { x: 128, y: 128 };
});

rightJoystick.on("move", (evt, data) => {
  rightStick = convertToStickValue(data);
});

rightJoystick.on("end", async () => {
  rightStick = { x: 128, y: 128 };
  // Immediately send neutral position to ensure it's not missed
  await fetch(`/stick/right/128/128`, { method: "POST" });
  lastRightStick = { x: 128, y: 128 };
});

// Send stick updates at fixed interval
setInterval(async () => {
  // Only send if position changed
  if (leftStick.x !== lastLeftStick.x || leftStick.y !== lastLeftStick.y) {
    await fetch(`/stick/left/${leftStick.x}/${leftStick.y}`, {
      method: "POST",
    });
    lastLeftStick = { ...leftStick };
  }

  if (rightStick.x !== lastRightStick.x || rightStick.y !== lastRightStick.y) {
    await fetch(`/stick/right/${rightStick.x}/${rightStick.y}`, {
      method: "POST",
    });
    lastRightStick = { ...rightStick };
  }
}, 1000 / 30);
