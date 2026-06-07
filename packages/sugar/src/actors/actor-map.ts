import type { AnyActor, Snapshot } from "@mantaq/core";
import type { SendableMap } from "../transitions/broadcast.ts";

export class ActorMap implements SendableMap {
  #actors = new Map<string, AnyActor>();
  #parent: AnyActor | null;

  constructor(parent?: AnyActor) {
    this.#parent = parent ?? null;
  }

  spawn(key: string, factory: () => AnyActor): void {
    const child = factory();
    if (this.#parent) {
      child.__outputHandler = (event) => {
        this.#parent!.send(event);
      };
    }
    this.#actors.set(key, child);
  }

  send(key: string, event: unknown): void {
    this.#actors.get(key)?.send(event as { id: string; [key: string]: unknown });
  }

  kill(key: string): void {
    this.#actors.delete(key);
  }

  keys(): string[] {
    return [...this.#actors.keys()];
  }

  ensure(key: string, factory: () => AnyActor): void {
    if (!this.#actors.has(key)) {
      this.spawn(key, factory);
    }
  }

  snapshot(key: string): Snapshot | undefined {
    return this.#actors.get(key)?.snapshot();
  }
}
