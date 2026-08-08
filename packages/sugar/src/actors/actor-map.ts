import type { AnyActor, Snapshot } from "@mantaq/core";
import { abortEffects, setOutputHandler } from "@mantaq/core/internal";
import { Either } from "@mantaq/utils";
import type { SendableEvent, SendableMap } from "../transitions/broadcast.ts";

export class ActorMap implements SendableMap<SendableEvent> {
  #actors = new Map<string, AnyActor>();
  #parent: AnyActor | null;

  constructor(parent?: AnyActor) {
    this.#parent = parent ?? null;
  }

  spawn(key: string, factory: () => AnyActor): void {
    if (this.#actors.has(key)) {
      console.warn(`[ActorMap] spawning over existing key "${key}". Old actor will be aborted.`);
      this.kill(key);
    }
    const child = factory();
    if (this.#parent) {
      Either.match(
        setOutputHandler(child, (event) => {
          this.#parent!.send(event);
        }),
        (err) => console.error(err.message),
        () => {},
      );
    }
    this.#actors.set(key, child);
  }

  send(key: string, event: SendableEvent): void {
    this.#actors.get(key)?.send(event);
  }

  kill(key: string): void {
    const actor = this.#actors.get(key);
    if (actor) {
      Either.match(
        abortEffects(actor),
        (err) => console.error(err.message),
        () => {},
      );
    }
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

  ensure(key: string, factory: () => AnyActor): void {
    if (!this.#actors.has(key)) {
      this.spawn(key, factory);
    }
  }

  snapshot(key: string): Snapshot | undefined {
    return this.#actors.get(key)?.snapshot();
  }
}
