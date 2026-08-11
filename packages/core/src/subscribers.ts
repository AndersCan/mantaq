import type { Snapshot } from "./actor-types.ts";
import { Either } from "@mantaq/utils";

export class Subscribers<C> {
  readonly change = new Set<(snapshot: Snapshot<C>, prev: Snapshot<C>) => void>();
  readonly done = new Set<() => void>();
  #last: Snapshot<C> | null = null;

  seed(snapshot: Snapshot<C>): void {
    this.#last = snapshot;
  }

  addChange(fn: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void): () => void {
    this.change.add(fn);
    const last = this.#last;
    if (last) this.#safe(() => fn(last, last));
    return () => this.change.delete(fn);
  }

  addDone(fn: () => void): () => void {
    this.done.add(fn);
    return () => this.done.delete(fn);
  }

  emitChange(snapshot: Snapshot<C>): void {
    const prev = this.#last ?? snapshot;
    this.#last = snapshot;
    for (const fn of this.change) {
      this.#safe(() => fn(snapshot, prev));
    }
  }

  emitDone(): void {
    for (const fn of this.done) {
      this.#safe(fn);
    }
  }

  clear(): void {
    this.change.clear();
    this.done.clear();
  }

  #safe(fn: () => void): void {
    const err = Either.from(fn);
    if (err[0] !== undefined) {
      console.warn(
        `[Actor] subscriber threw: ${err[0] instanceof Error ? err[0].message : "unknown error"}`,
      );
    }
  }
}
