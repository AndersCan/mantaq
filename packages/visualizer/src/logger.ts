type LogLevel = "debug" | "info" | "warn" | "error";

function isDevMode(): boolean {
  try {
    if (
      typeof globalThis !== "undefined" &&
      "process" in globalThis &&
      typeof (globalThis as Record<string, unknown>).process === "object" &&
      (globalThis as Record<string, unknown>).process !== null
    ) {
      const proc = (globalThis as Record<string, unknown>).process as Record<string, unknown>;
      if (typeof proc.env === "object" && proc.env !== null) {
        return (proc.env as Record<string, unknown>).NODE_ENV !== "production";
      }
    }
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  }
  return false;
}

const enabled = isDevMode();

const PREFIX = "[mantaq-viz]";

function formatMsg(level: LogLevel, source: string, message: string): string {
  return `${PREFIX} [${level.toUpperCase()}] [${source}] ${message}`;
}

export function logDebug(source: string, message: string): void {
  if (!enabled) return;
  console.debug(formatMsg("debug", source, message));
}

export function logInfo(source: string, message: string): void {
  if (!enabled) return;
  console.info(formatMsg("info", source, message));
}

export function logWarn(source: string, message: string): void {
  if (!enabled) return;
  console.warn(formatMsg("warn", source, message));
}

export function logError(source: string, message: string, err?: unknown): void {
  if (!enabled) return;
  console.error(formatMsg("error", source, message), err ?? "");
}
