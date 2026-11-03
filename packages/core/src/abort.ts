type AbortListener = (event: object) => void;
type Entry = { fn: AbortListener; once: boolean; removed: boolean };

export function createAbortController(): AbortController {
  if (typeof globalThis.AbortController === "function") {
    return new globalThis.AbortController();
  }
  let entries: Entry[] = [];
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    onabort: undefined as AbortListener | undefined,
    addEventListener(type: string, fn: AbortListener, options?: { once?: boolean }) {
      if (type === "abort" && !entries.some((entry) => entry.fn === fn)) {
        entries.push({ fn, once: options?.once === true, removed: false });
      }
    },
    removeEventListener(type: string, fn: AbortListener) {
      if (type !== "abort") return;
      for (const entry of entries) if (entry.fn === fn) entry.removed = true;
      entries = entries.filter((entry) => entry.fn !== fn);
    },
    throwIfAborted() {
      if (signal.aborted) throw signal.reason;
    },
  };
  function abort(reason?: unknown) {
    if (signal.aborted) return;
    signal.aborted = true;
    signal.reason = reason === undefined ? new Error("This operation was aborted") : reason;
    const event = { type: "abort", target: signal };
    const snapshot = entries;
    entries = snapshot.filter((entry) => !entry.once);
    const errors: unknown[] = [];
    try {
      signal.onabort?.(event);
    } catch (error) {
      errors.push(error);
    }
    for (const entry of snapshot) {
      if (entry.removed) continue;
      try {
        entry.fn(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  }
  return asController({ signal, abort });
}

function asController(value: object): AbortController {
  return value as AbortController;
}
