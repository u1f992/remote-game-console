import nipplejs from "nipplejs";

const joystickSize = 125;
document.documentElement.style.setProperty(
  "--joystick-size-value",
  String(joystickSize),
);

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
