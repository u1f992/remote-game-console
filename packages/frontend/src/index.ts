import { start as startAudio } from "./audio.js";
import { overrideAspectRatio } from "./video.js";
import { logError } from "./log.js";
import { start as startController } from "./controller.js";
import { setup as setupJoystick } from "./joystick.js";
import { setup as setupButtons } from "./buttons.js";

const controller = startController();
setupJoystick(controller);
setupButtons(controller);

document.getElementById("btn-reload")!.addEventListener("click", () => {
  window.location.reload();
});

const logArea = document.getElementById("log-area")!;
document.getElementById("btn-toggle-log")!.addEventListener("click", () => {
  logArea.classList.toggle("visible");

  // Scroll to bottom when showing log area
  if (logArea.classList.contains("visible")) {
    logArea.scrollTop = logArea.scrollHeight;
  }
});

const fullscreenButton = document.getElementById("btn-fullscreen")!;

fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    try {
      await document.documentElement.requestFullscreen();
    } catch (err) {
      logError("Failed to enter fullscreen:", err);
    }
  }
});

// Update button state when fullscreen changes
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    fullscreenButton.classList.add("active");
  } else {
    fullscreenButton.classList.remove("active");
  }
});

const params = new URLSearchParams(window.location.search);
const audioTargetLatency = params.get("audioTargetLatency");
const audioMaxLatency = params.get("audioMaxLatency");
const videoAspectRatioWidth = params.get("videoAspectRatioWidth");
const videoAspectRatioHeight = params.get("videoAspectRatioHeight");

if (
  audioTargetLatency === null ||
  audioMaxLatency === null ||
  (videoAspectRatioWidth === null &&
    typeof videoAspectRatioHeight === "string") ||
  (typeof videoAspectRatioWidth === "string" && videoAspectRatioHeight === null)
) {
  const newParams = new URLSearchParams(params);
  if (audioTargetLatency === null) {
    newParams.set("audioTargetLatency", "100");
  }
  if (audioMaxLatency === null) {
    newParams.set("audioMaxLatency", "250");
  }
  if (
    videoAspectRatioWidth === null &&
    typeof videoAspectRatioHeight === "string"
  ) {
    newParams.delete("videoAspectRatioHeight");
  }
  if (
    typeof videoAspectRatioWidth === "string" &&
    videoAspectRatioHeight === null
  ) {
    newParams.delete("videoAspectRatioWidth");
  }
  window.location.href = `${window.location.pathname}?${newParams.toString()}`;
}

const AUDIO_TARGET_LATENCY = parseFloat(audioTargetLatency ?? "100") / 1000;
const AUDIO_MAX_LATENCY = parseFloat(audioMaxLatency ?? "250") / 1000;

let audioConnection: ReturnType<typeof startAudio> | null = null;
const audioButton = document.getElementById("btn-audio")!;

audioButton.addEventListener("click", () => {
  if (audioConnection) {
    // Stop audio
    audioConnection.close();
    audioConnection = null;
    audioButton.classList.remove("active");
  } else {
    // Start audio
    audioConnection = startAudio({
      targetLatency: AUDIO_TARGET_LATENCY,
      maxLatency: AUDIO_MAX_LATENCY,
    });
    // Resume AudioContext (required by browser autoplay policy)
    audioConnection.resume();
    audioButton.classList.add("active");
  }
});

if (
  typeof videoAspectRatioWidth === "string" &&
  typeof videoAspectRatioHeight === "string"
) {
  const VIDEO_ASPECT_RATIO_WIDTH = parseFloat(videoAspectRatioWidth);
  const VIDEO_ASPECT_RATIO_HEIGHT = parseFloat(videoAspectRatioHeight);
  overrideAspectRatio({
    width: VIDEO_ASPECT_RATIO_WIDTH,
    height: VIDEO_ASPECT_RATIO_HEIGHT,
  });
}
