import { log, logError } from "./log.js";

type ControllerMessage =
  | {
      type: "button";
      button: string;
      action: "press" | "release";
    }
  | {
      type: "hat";
      direction: string;
    }
  | {
      type: "stick";
      stick: "left" | "right";
      x: number;
      y: number;
    };

export function start() {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/controller`;

  (function connect() {
    log("[controller] Connecting to:", wsUrl);
    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      log("[controller] WebSocket connected");
    });

    ws.addEventListener("close", (event) => {
      log("[controller] WebSocket closed:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      ws = null;
      reconnectTimer = window.setTimeout(connect, 1000);
    });

    ws.addEventListener("error", (err) => {
      logError("[controller] WebSocket error:", err);
    });
  })();

  return {
    send(message: ControllerMessage) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    close() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    },
  };
}
