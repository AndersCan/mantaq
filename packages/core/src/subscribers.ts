import type { Snapshot } from "./actor-types.ts";

export class Subscribers<C> {
  readonly change = new Set<(snapshot: Snapshot<C>, prev: Snapshot<C>) => void>();
  readonly done = new Set<() => void>();
  #last: Snapshot<C> | null = null;

  seed(snapshot: Snapshot<C>): void {
    this.#last = snapshot;
  }

  addChange(fn: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void): () => void {
    this.change.add(fn);
    if (this.#last) fn(this.#last, this.#last);
    return () => this.change.delete(fn);
  }

  addDone(fn: () => void): () => void {
    this.done.add(fn);
    return () => this.done.delete(fn);
  }

  emitChange(snapshot: Snapshot<C>): void {
    const prev = this.#last ?? snapshot;
    this.#last = snapshot;
    for (const fn of this.change) fn(snapshot, prev);
  }

  emitDone(): void {
    for (const fn of this.done) fn();
  }

  clear(): void {
    this.change.clear();
    this.done.clear();
  }
}
