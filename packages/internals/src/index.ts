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
