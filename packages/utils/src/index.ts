import type { Snapshot } from "@mantaq/core";

export function statePath(snapshot: Snapshot): string {
  return snapshot.path.join(".");
}

export function isDone(snapshot: Snapshot): boolean {
  return snapshot.done === true;
}

export function flattenSnapshot(snapshot: Snapshot): Snapshot[] {
  const results: Snapshot[] = [snapshot];
  for (const region of Object.values(snapshot.regions)) {
    results.push(...flattenSnapshot(region));
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
    if (key in obj) {
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
