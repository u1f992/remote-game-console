import { logError } from "./log.js";

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
} as const;

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
    logError("Hat update error:", err);
  }
}

// Setup button event handlers
(Object.keys(buttonMap) as (keyof typeof buttonMap)[]).forEach((btnId) => {
  const button = document.getElementById(btnId)!;
  const buttonName = buttonMap[btnId];

  button.addEventListener("mousedown", async () => {
    try {
      await fetch(`/button/press/${buttonName}`, { method: "POST" });
    } catch (err) {
      logError("Button press error:", err);
    }
  });

  button.addEventListener("mouseup", async () => {
    try {
      await fetch(`/button/release/${buttonName}`, { method: "POST" });
    } catch (err) {
      logError("Button release error:", err);
    }
  });

  button.addEventListener("touchstart", async (e) => {
    e.preventDefault();
    button.classList.add("active");
    try {
      await fetch(`/button/press/${buttonName}`, { method: "POST" });
    } catch (err) {
      logError("Button press error:", err);
    }
  });

  button.addEventListener("touchend", async (e) => {
    e.preventDefault();
    button.classList.remove("active");
    try {
      await fetch(`/button/release/${buttonName}`, { method: "POST" });
    } catch (err) {
      logError("Button release error:", err);
    }
  });
});

// D-pad button mappings
const dpadButtons = {
  "btn-up": "up",
  "btn-down": "down",
  "btn-left": "left",
  "btn-right": "right",
} as const;

// Setup D-pad event handlers
(Object.keys(dpadButtons) as (keyof typeof dpadButtons)[]).forEach((btnId) => {
  const button = document.getElementById(btnId)!;
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
