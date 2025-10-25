import type { start } from "./controller.js";

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

// D-pad button mappings
const dpadButtons = {
  "btn-up": "up",
  "btn-down": "down",
  "btn-left": "left",
  "btn-right": "right",
} as const;

export function setup(controller: ReturnType<typeof start>) {
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

  function updateHat() {
    const hatValue = getHatValue();
    controller.send({
      type: "hat",
      direction: hatValue,
    });
  }

  // Setup button event handlers
  (Object.keys(buttonMap) as (keyof typeof buttonMap)[]).forEach((btnId) => {
    const button = document.getElementById(btnId)!;
    const buttonName = buttonMap[btnId];

    button.addEventListener("mousedown", () => {
      controller.send({
        type: "button",
        button: buttonName,
        action: "press",
      });
    });

    button.addEventListener("mouseup", () => {
      controller.send({
        type: "button",
        button: buttonName,
        action: "release",
      });
    });

    button.addEventListener("touchstart", (e) => {
      e.preventDefault();
      button.classList.add("active");
      controller.send({
        type: "button",
        button: buttonName,
        action: "press",
      });
    });

    button.addEventListener("touchend", (e) => {
      e.preventDefault();
      button.classList.remove("active");
      controller.send({
        type: "button",
        button: buttonName,
        action: "release",
      });
    });
  });

  // Setup D-pad event handlers
  (Object.keys(dpadButtons) as (keyof typeof dpadButtons)[]).forEach(
    (btnId) => {
      const button = document.getElementById(btnId)!;
      const direction = dpadButtons[btnId];

      button.addEventListener("mousedown", () => {
        dpadState[direction] = true;
        updateHat();
      });

      button.addEventListener("mouseup", () => {
        dpadState[direction] = false;
        updateHat();
      });

      button.addEventListener("touchstart", (e) => {
        e.preventDefault();
        button.classList.add("active");
        dpadState[direction] = true;
        updateHat();
      });

      button.addEventListener("touchend", (e) => {
        e.preventDefault();
        button.classList.remove("active");
        dpadState[direction] = false;
        updateHat();
      });
    },
  );
}
