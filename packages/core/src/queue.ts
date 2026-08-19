import type { InternalEvent } from "./event.ts";

export type CancellableProcessEventFn = (event: InternalEvent) => boolean;

export class InternalQueue {
  #queue: InternalEvent[] = [];
  #index = 0;
  #processing = false;
  #stopped = false;
  #settledResolvers: Array<() => void> = [];

  get length(): number {
    return this.#queue.length - this.#index;
  }

  push(...events: InternalEvent[]): void {
    if (this.#stopped) return;
    this.#queue.push(...events);
  }

  clear(): void {
    const resolvers = this.#settledResolvers.splice(0);
    this.#queue.length = 0;
    this.#index = 0;
    for (const resolve of resolvers) {
      resolve();
    }
  }

  settled(): Promise<void> {
    if (this.length === 0 && !this.#processing) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.#settledResolvers.push(resolve);
    });
  }

  processCancellable(processEvent: CancellableProcessEventFn): void {
    this.#process(processEvent);
  }

  #process(processEvent: CancellableProcessEventFn): void {
    if (this.#processing) return;
    this.#processing = true;
    try {
      while (this.#index < this.#queue.length) {
        if (this.#stopped) break;
        const event = this.#queue[this.#index++];
        if (!processEvent(event)) {
          this.#stopped = true;
          break;
        }
      }
    } finally {
      this.#queue.length = 0;
      this.#index = 0;
      this.#processing = false;
      this.#stopped = false;
      const resolvers = this.#settledResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }
}
