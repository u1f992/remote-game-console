import { start as startAudio } from "./audio.js";
import { overrideAspectRatio } from "./video.js";
import "./joystick.js";
import "./buttons.js";

const params = new URLSearchParams(window.location.search);
const audioTargetLatency = params.get("audioTargetLatency");
const audioMaxLatency = params.get("audioMaxLatency");
const videoAspectRatioHeight = params.get("videoAspectRatioHeight");
const videoAspectRatioWidth = params.get("videoAspectRatioWidth");

if (
  audioTargetLatency === null ||
  audioMaxLatency === null ||
  (videoAspectRatioWidth === null &&
    typeof videoAspectRatioHeight === "string") ||
  (typeof videoAspectRatioWidth === "string" && videoAspectRatioHeight === null)
) {
  const defaultParams = new URLSearchParams({
    audioTargetLatency: "50",
    audioMaxLatency: "200",
  });
  window.location.href = `${window.location.pathname}?${defaultParams.toString()}`;
}

const AUDIO_TARGET_LATENCY = parseFloat(audioTargetLatency ?? "50") / 1000;
const AUDIO_MAX_LATENCY = parseFloat(audioMaxLatency ?? "200") / 1000;

startAudio({
  targetLatency: AUDIO_TARGET_LATENCY,
  maxLatency: AUDIO_MAX_LATENCY,
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
