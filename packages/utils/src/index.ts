import type { Snapshot } from "@mantaq/core";

export function statePath(snapshot: Snapshot): string {
  return snapshot.path.join(".");
}

export function isDone(snapshot: Snapshot): boolean {
  return snapshot.done === true;
}

export function flattenSnapshot(snapshot: Snapshot, maxDepth = 50): Snapshot[] {
  const results: Snapshot[] = [snapshot];
  if (maxDepth <= 0) return results;
  for (const region of Object.values(snapshot.regions)) {
    results.push(...flattenSnapshot(region, maxDepth - 1));
  }
  return results;
}

export function noop(): void {}

export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export function shallowMerge<T extends Record<string, unknown>, S extends Record<string, unknown>>(
  target: T,
  source: S,
): T & S {
  const result = { ...target } as T & S;
  for (const key of Object.keys(source) as (keyof S)[]) {
    const val = source[key];
    if (val !== undefined) {
      (result as Record<string, unknown>)[key as string] = val;
    }
  }
  return result;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (Object.hasOwn(obj, key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts: number; delay?: number; signal?: AbortSignal } = { attempts: 3 },
): Promise<T> {
  const { attempts, delay: backoff = 0, signal } = options;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1 && backoff > 0) {
        await delay(backoff * 2 ** i, signal);
      }
    }
  }
  throw lastError;
}
