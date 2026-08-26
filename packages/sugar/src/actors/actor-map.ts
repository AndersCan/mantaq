import type { SendableEvent, SendableMap } from "../transitions/broadcast.ts";
import type { Snapshot } from "@mantaq/core";

/**
 * Minimal actor surface the map needs. Real actors satisfy this
 * structurally — tests can substitute tiny fakes.
 */
export interface ActorMapChild {
  snapshot(): Snapshot;
  on(event: "done", listener: { fn: () => void }): () => void;
  send(...events: [event: SendableEvent]): void;
  dispose(): void;
}

/**
 * Keyed registry of one actor type. `spawn(key)` builds a fresh instance via
 * the factory — same actor shape, keyed by id. The factory receives the key.
 *
 * With autoReap enabled, a child that reaches a final state (or dies into
 * `__error`) is removed from the map automatically. Without it, completed
 * children linger until explicitly killed.
 */
export interface ActorMap extends SendableMap<SendableEvent> {
  spawn(key: string): void;
  kill(key: string): void;
  dispose(): void;
  ensure(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  snapshot(key: string): Snapshot | undefined;
  readonly size: number;
}

export function createActorMap(
  factory: (id: string) => ActorMapChild,
  { autoReap }: { autoReap?: boolean } = {},
): ActorMap {
  const actors = new Map<string, ActorMapChild>();
  const reapers = new Map<string, () => void>();
  const reap = autoReap === true;

  function spawn(key: string): void {
    if (actors.has(key)) {
      kill(key);
    }
    const child = factory(key);
    actors.set(key, child);
    if (!reap) return;
    if (child.snapshot().done) {
      actors.delete(key);
      void Promise.resolve().then(() => child.dispose());
      return;
    }
    const off = child.on("done", {
      fn: () => {
        off();
        if (actors.get(key) === child) actors.delete(key);
        reapers.delete(key);
        void Promise.resolve().then(() => child.dispose());
      },
    });
    reapers.set(key, off);
  }

  function kill(key: string): void {
    actors.get(key)?.dispose();
    reapers.get(key)?.();
    reapers.delete(key);
    actors.delete(key);
  }

  /**
   * Tear down the map and every live child. Without this, dropping an
   * actor map (e.g. when its owning actor is disposed) leaks every child
   * actor whose effects/timers/reapers keep running. Idempotent.
   */
  function dispose(): void {
    for (const child of actors.values()) {
      child.dispose();
    }
    for (const off of reapers.values()) {
      off();
    }
    reapers.clear();
    actors.clear();
  }

  function ensure(key: string): void {
    if (!actors.has(key)) {
      spawn(key);
    }
  }

  function has(key: string): boolean {
    return actors.has(key);
  }

  function keys(): string[] {
    return [...actors.keys()];
  }

  function snapshotOf(key: string): Snapshot | undefined {
    return actors.get(key)?.snapshot();
  }

  return {
    spawn,
    kill,
    dispose,
    ensure,
    has,
    keys,
    snapshot: snapshotOf,
    send(key, ...events) {
      for (const event of events) {
        actors.get(key)?.send(event);
      }
    },
    get size(): number {
      return actors.size;
    },
  };
}
