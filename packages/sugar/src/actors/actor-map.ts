import type { AnyActor, Snapshot } from "@mantaq/core";
import type { SendableEvent, SendableMap } from "../transitions/broadcast.ts";

export interface ActorMapOptions {
  /**
   * When true, a child that reaches a final state (or dies into `__error`)
   * is removed from the map automatically. Without it, completed children
   * linger until explicitly `kill`ed.
   */
  autoReap?: boolean;
}

/**
 * Keyed registry of one actor type. `spawn(key)` builds a fresh instance via
 * the factory — same actor shape, keyed by id. The factory receives the key.
 */
export class ActorMap implements SendableMap<SendableEvent> {
  #actors = new Map<string, AnyActor>();
  #reapers = new Map<string, () => void>();
  #factory: (id: string) => AnyActor;
  #autoReap: boolean;

  constructor(factory: (id: string) => AnyActor, options: ActorMapOptions = {}) {
    this.#factory = factory;
    this.#autoReap = options.autoReap === true;
  }

  spawn(key: string): void {
    if (this.#actors.has(key)) {
      this.kill(key);
    }
    const child = this.#factory(key);
    this.#actors.set(key, child);
    if (this.#autoReap) {
      if (child.snapshot().done) {
        this.#actors.delete(key);
        return;
      }
      const off = child.on("done", () => {
        off();
        if (this.#actors.get(key) === child) this.#actors.delete(key);
        this.#reapers.delete(key);
        child.dispose();
      });
      this.#reapers.set(key, off);
    }
  }

  send(key: string, event: SendableEvent): void {
    this.#actors.get(key)?.send(event);
  }

  kill(key: string): void {
    const actor = this.#actors.get(key);
    actor?.dispose();
    this.#reapers.get(key)?.();
    this.#reapers.delete(key);
    this.#actors.delete(key);
  }

  get size(): number {
    return this.#actors.size;
  }

  has(key: string): boolean {
    return this.#actors.has(key);
  }

  keys(): string[] {
    return [...this.#actors.keys()];
  }

  ensure(key: string): void {
    if (!this.#actors.has(key)) {
      this.spawn(key);
    }
  }

  snapshot(key: string): Snapshot | undefined {
    return this.#actors.get(key)?.snapshot();
  }
}
