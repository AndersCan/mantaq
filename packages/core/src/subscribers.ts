import type { Snapshot } from "./actor-types.ts";

export class Subscribers {
  readonly change = new Set<(snapshot: Snapshot) => void>();
  readonly done = new Set<() => void>();

  addChange(fn: (snapshot: Snapshot) => void): () => void {
    this.change.add(fn);
    return () => this.change.delete(fn);
  }

  addDone(fn: () => void): () => void {
    this.done.add(fn);
    return () => this.done.delete(fn);
  }

  emitChange(snapshot: Snapshot): void {
    for (const fn of this.change) fn(snapshot);
  }

  emitDone(): void {
    for (const fn of this.done) fn();
  }

  clear(): void {
    this.change.clear();
    this.done.clear();
  }
}
