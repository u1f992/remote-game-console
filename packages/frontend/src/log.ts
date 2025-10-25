// Log helper
const logArea = document.getElementById("log-area")!;

function formatMessage(...args: unknown[]): string {
  return args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
}

function appendToLogArea(message: string, color?: string) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.textContent = `[${timestamp}] ${message}`;
  if (color) {
    logEntry.style.color = color;
  }
  logArea.appendChild(logEntry);
  // Auto-scroll to bottom
  logArea.scrollTop = logArea.scrollHeight;
}

export function log(...args: unknown[]) {
  const message = formatMessage(...args);
  appendToLogArea(message);
  console.log(...args);
}

export function logWarn(...args: unknown[]) {
  const message = formatMessage(...args);
  appendToLogArea(message, 'yellow');
  console.warn(...args);
}

export function logError(...args: unknown[]) {
  const message = formatMessage(...args);
  appendToLogArea(message, 'red');
  console.error(...args);
}
