import type { ErrorInfo, Snapshot, TransitionInfo } from "./actor-types.ts";
import type { InternalEvent } from "./index.ts";
import { Either } from "@mantaq/utils";

export interface Subscribers<C> {
  readonly change: Set<(snapshot: Snapshot<C>, prev: Snapshot<C>) => void>;
  readonly done: Set<() => void>;
  readonly transition: Set<(info: TransitionInfo) => void>;
  readonly error: Set<(info: ErrorInfo) => void>;
  readonly output: Set<(event: InternalEvent) => void>;
  seed(snapshot: Snapshot<C>): void;
  addChange(fn: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void): () => void;
  addDone(fn: () => void): () => void;
  addTransition(fn: (info: TransitionInfo) => void): () => void;
  addError(fn: (info: ErrorInfo) => void): () => void;
  addOutput(fn: (event: InternalEvent) => void): () => void;
  emitChange(snapshot: Snapshot<C>): void;
  emitDone(): void;
  emitTransition(info: TransitionInfo): void;
  emitError(info: ErrorInfo): void;
  emitOutput(event: InternalEvent): void;
  clear(): void;
}

export function Subscribers<C>(): Subscribers<C> {
  const change = new Set<(snapshot: Snapshot<C>, prev: Snapshot<C>) => void>();
  const done = new Set<() => void>();
  const transition = new Set<(info: TransitionInfo) => void>();
  const error = new Set<(info: ErrorInfo) => void>();
  const output = new Set<(event: InternalEvent) => void>();

  let last: Snapshot<C> | undefined;

  /**
   * A subscriber only watches the machine. It never changes it. A throwing
   * subscriber is swallowed so the machine and its callers are unaffected.
   */
  function safe(callback: () => void): void {
    void Either.from(() => (callback(), true));
  }

  return {
    change,
    done,
    transition,
    error,
    output,

    seed(snapshot: Snapshot<C>): void {
      last = snapshot;
    },

    addChange(fn): () => void {
      change.add(fn);
      const seeded = last;
      if (seeded) safe(() => fn(seeded, seeded));
      return () => change.delete(fn);
    },

    addDone(fn): () => void {
      done.add(fn);
      return () => done.delete(fn);
    },

    addTransition(fn): () => void {
      transition.add(fn);
      return () => transition.delete(fn);
    },

    addError(fn): () => void {
      error.add(fn);
      const seeded = last?.error;
      if (seeded) {
        safe(() => fn(seeded));
      }
      return () => error.delete(fn);
    },

    addOutput(fn): () => void {
      output.add(fn);
      return () => output.delete(fn);
    },

    emitChange(snapshot: Snapshot<C>): void {
      const prev = last ?? snapshot;
      last = snapshot;
      for (const callback of change) {
        safe(() => callback(snapshot, prev));
      }
    },

    emitDone(): void {
      for (const callback of done) {
        safe(callback);
      }
    },

    emitTransition(info: TransitionInfo): void {
      for (const callback of transition) {
        safe(() => callback(info));
      }
    },

    emitError(info: ErrorInfo): void {
      for (const callback of error) {
        safe(() => callback(info));
      }
    },

    /**
     * Output delivery is machine-facing: a throwing handler must let the
     * actor's safety wrapper route it into the error state, so no swallow
     * here. The actor wraps this call in its own guard.
     */
    emitOutput(event: InternalEvent): void {
      for (const callback of output) {
        callback(event);
      }
    },

    clear(): void {
      change.clear();
      done.clear();
      transition.clear();
      error.clear();
      output.clear();
    },
  };
}
