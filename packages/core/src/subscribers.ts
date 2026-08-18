import type { ErrorInfo, Snapshot, TransitionInfo } from "./actor-types.ts";
import { Either } from "@mantaq/utils";

export class Subscribers<C> {
  readonly change = new Set<(snapshot: Snapshot<C>, prev: Snapshot<C>) => void>();
  readonly done = new Set<() => void>();
  readonly transition = new Set<(info: TransitionInfo) => void>();
  readonly error = new Set<(info: ErrorInfo) => void>();
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

  addTransition(fn: (info: TransitionInfo) => void): () => void {
    this.transition.add(fn);
    return () => this.transition.delete(fn);
  }

  addError(fn: (info: ErrorInfo) => void): () => void {
    this.error.add(fn);
    const last = this.#last?.error;
    if (last) {
      this.#safe(() => fn(last));
    }
    return () => this.error.delete(fn);
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

  emitTransition(info: TransitionInfo): void {
    for (const fn of this.transition) {
      this.#safe(() => fn(info));
    }
  }

  emitError(info: ErrorInfo): void {
    for (const fn of this.error) {
      this.#safe(() => fn(info));
    }
  }

  clear(): void {
    this.change.clear();
    this.done.clear();
    this.transition.clear();
    this.error.clear();
  }

  #safe(fn: () => void): void {
    // A subscriber only watches the machine — it never changes it. Its throw
    // is swallowed so the machine and its callers are unaffected.
    void Either.from(fn);
  }
}
