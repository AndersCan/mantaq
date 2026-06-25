import type { Snapshot } from "./actor-types.ts";

export class Subscribers {
  readonly change = new Set<(snapshot: Snapshot) => void>();
  readonly done = new Set<() => void>();
  readonly error = new Set<(err: unknown) => void>();

  addChange(fn: (snapshot: Snapshot) => void): () => void {
    this.change.add(fn);
    return () => this.change.delete(fn);
  }

  addDone(fn: () => void): () => void {
    this.done.add(fn);
    return () => this.done.delete(fn);
  }

  addError(fn: (err: unknown) => void): () => void {
    this.error.add(fn);
    return () => this.error.delete(fn);
  }

  emitChange(snapshot: Snapshot): void {
    for (const fn of this.change) fn(snapshot);
  }

  emitDone(): void {
    for (const fn of this.done) fn();
  }

  emitError(err: unknown): void {
    for (const fn of this.error) {
      try {
        fn(err);
      } catch {
        // error subscriber threw — ignore to prevent crash
      }
    }
  }

  clear(): void {
    this.change.clear();
    this.done.clear();
    this.error.clear();
  }
}
