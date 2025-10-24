function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
  console.log({ vh });
}

setViewportHeight();
window.addEventListener("resize", setViewportHeight);
window.addEventListener("orientationchange", setViewportHeight);

// Prevent long-press context menu on video stream
const videoStream = document.getElementById("video-stream")!;
videoStream.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

export function overrideAspectRatio({
  width,
  height,
}:
  | { width: number; height: number }
  | { width?: undefined; height?: undefined }) {
  console.log(`[video] apply overrideAspectRatio: ${width}:${height}`);

  function updateVideoSize() {
    if (typeof width === "undefined" || typeof height === "undefined") {
      return;
    }

    const aspectRatio = width / height;

    const container = document.getElementById("video-container")!;
    const videoStream = document.getElementById("video-stream")!;

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

  updateVideoSize();
  window.addEventListener("resize", updateVideoSize);
  window.addEventListener("orientationchange", updateVideoSize);
}
