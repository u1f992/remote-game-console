import { SerialPort } from "serialport";

export const Button = Object.freeze({
  Y: 1,
  B: 2,
  A: 4,
  X: 8,
  L: 16,
  R: 32,
  ZL: 64,
  ZR: 128,
  Plus: 256,
  Minus: 512,
  LClick: 1024,
  RClick: 2048,
  Home: 4096,
  Capture: 8192,
});

export const Hat = Object.freeze({
  Up: 0,
  UpRight: 1,
  Right: 2,
  DownRight: 3,
  Down: 4,
  DownLeft: 5,
  Left: 6,
  UpLeft: 7,
  Neutral: 8,
});

/**
 * top-left origin
 */
const STICK_NEUTRAL = 0x80;

const HEADER = 0xab;

function send(
  port: SerialPort,
  state: {
    buttons: number;
    hat: number;
    left: { x: number; y: number };
    right: { x: number; y: number };
  },
  verbose: boolean,
) {
  const bytes = new Uint8Array([
    HEADER,
    state.buttons & 0xff,
    state.buttons >> 8,
    state.hat,
    state.left.x,
    state.left.y,
    state.right.x,
    state.right.y,
    0,
    0,
    0,
  ]);
  if (verbose) {
    console.log(`[controller] ${bytes}`);
  }
  const ret = port.write(bytes);
  if (verbose) {
    console.log(`[controller] ret=${ret}`);
  }
}

export function start({
  path,
  baudRate,
  verbose,
}: {
  path: string;
  baudRate: number;
  verbose?: boolean;
}) {
  const port = new SerialPort({ path, baudRate });

  const state = {
    buttons: 0,
    hat: Hat.Neutral as number,
    left: { x: STICK_NEUTRAL, y: STICK_NEUTRAL },
    right: { x: STICK_NEUTRAL, y: STICK_NEUTRAL },
  };
  send(port, state, verbose ?? false);

  return {
    pressButton(button: number) {
      state.buttons |= button;
      send(port, state, verbose ?? false);
    },
    releaseButton(button: number) {
      state.buttons &= ~button;
      send(port, state, verbose ?? false);
    },
    updateHat(hat: number) {
      state.hat = hat;
      send(port, state, verbose ?? false);
    },
    updateLeftStick({ x, y }: { x: number; y: number }) {
      state.left.x = x;
      state.left.y = y;
      send(port, state, verbose ?? false);
    },
    updateRightStick({ x, y }: { x: number; y: number }) {
      state.right.x = x;
      state.right.y = y;
      send(port, state, verbose ?? false);
    },
  };
}
