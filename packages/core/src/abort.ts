type AbortListener = (event: object) => void;
type Entry = { fn: AbortListener; once: boolean };

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
        entries.push({ fn, once: options?.once === true });
      }
    },
    removeEventListener(type: string, fn: AbortListener) {
      if (type === "abort") entries = entries.filter((entry) => entry.fn !== fn);
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
    signal.onabort?.(event);
    for (const entry of snapshot) entry.fn(event);
  }
  return asController({ signal, abort });
}

function asController(value: object): AbortController {
  return value as AbortController;
}
