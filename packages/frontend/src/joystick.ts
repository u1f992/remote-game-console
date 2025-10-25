import nipplejs from "nipplejs";
import type { start } from "./controller.js";

const joystickSize = 125;
document.documentElement.style.setProperty(
  "--joystick-size-value",
  String(joystickSize),
);

function convertToStickValue(data: nipplejs.JoystickOutputData) {
  if (!data.distance || !data.angle) {
    return { x: 128, y: 128 };
  }

  // nipplejs distance ranges from 0 to size/2 (typically 50 for a 100px zone)
  const normalizedDistance = Math.min(
    data.distance / (data.instance.options.size! / 2),
    1.0,
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

export function setup(controller: ReturnType<typeof start>) {
  const leftZone = document.getElementById("left-joystick")!;
  const rightZone = document.getElementById("right-joystick")!;

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

  // Store current stick positions
  let leftStick = { x: 128, y: 128 };
  let rightStick = { x: 128, y: 128 };
  let lastLeftStick = { x: 128, y: 128 };
  let lastRightStick = { x: 128, y: 128 };

  // Update stick positions on move (don't send immediately)
  leftJoystick.on("move", (_, data) => {
    leftStick = convertToStickValue(data);
  });

  leftJoystick.on("end", () => {
    leftStick = { x: 128, y: 128 };
    // Immediately send neutral position to ensure it's not missed
    controller.send({
      type: "stick",
      stick: "left",
      x: 128,
      y: 128,
    });
    lastLeftStick = { x: 128, y: 128 };
  });

  rightJoystick.on("move", (_evt, data) => {
    rightStick = convertToStickValue(data);
  });

  rightJoystick.on("end", () => {
    rightStick = { x: 128, y: 128 };
    // Immediately send neutral position to ensure it's not missed
    controller.send({
      type: "stick",
      stick: "right",
      x: 128,
      y: 128,
    });
    lastRightStick = { x: 128, y: 128 };
  });

  // Send stick updates at fixed interval
  setInterval(() => {
    // Only send if position changed
    if (leftStick.x !== lastLeftStick.x || leftStick.y !== lastLeftStick.y) {
      controller.send({
        type: "stick",
        stick: "left",
        x: leftStick.x,
        y: leftStick.y,
      });
      lastLeftStick = { ...leftStick };
    }

    if (
      rightStick.x !== lastRightStick.x ||
      rightStick.y !== lastRightStick.y
    ) {
      controller.send({
        type: "stick",
        stick: "right",
        x: rightStick.x,
        y: rightStick.y,
      });
      lastRightStick = { ...rightStick };
    }
  }, 1000 / 30);
}
