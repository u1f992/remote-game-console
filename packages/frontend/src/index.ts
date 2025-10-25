import { start as startAudio } from "./audio.js";
import { overrideAspectRatio } from "./video.js";
import "./joystick.js";
import "./buttons.js";

const params = new URLSearchParams(window.location.search);
const noAudio = params.get("noAudio") === "true";
const audioTargetLatency = params.get("audioTargetLatency");
const audioMaxLatency = params.get("audioMaxLatency");
const videoAspectRatioWidth = params.get("videoAspectRatioWidth");
const videoAspectRatioHeight = params.get("videoAspectRatioHeight");

if (
  (!noAudio && (audioTargetLatency === null || audioMaxLatency === null)) ||
  (videoAspectRatioWidth === null &&
    typeof videoAspectRatioHeight === "string") ||
  (typeof videoAspectRatioWidth === "string" && videoAspectRatioHeight === null)
) {
  const newParams = new URLSearchParams(params);
  if (!noAudio) {
    if (audioTargetLatency === null) {
      newParams.set("audioTargetLatency", "80");
    }
    if (audioMaxLatency === null) {
      newParams.set("audioMaxLatency", "200");
    }
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

if (!noAudio) {
  const AUDIO_TARGET_LATENCY = parseFloat(audioTargetLatency ?? "80") / 1000;
  const AUDIO_MAX_LATENCY = parseFloat(audioMaxLatency ?? "200") / 1000;

  startAudio({
    targetLatency: AUDIO_TARGET_LATENCY,
    maxLatency: AUDIO_MAX_LATENCY,
  });
}

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
