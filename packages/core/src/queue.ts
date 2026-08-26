import type { InternalEvent } from "./index.ts";

type CancellableProcessEventFn = (event: InternalEvent) => boolean;

export interface InternalQueue {
  readonly length: number;
  push(...events: InternalEvent[]): void;
  clear(): void;
  settled(): Promise<void>;
  processCancellable(processEvent: CancellableProcessEventFn): void;
}

export function InternalQueue(): InternalQueue {
  let queue: InternalEvent[] = [];
  let index = 0;
  let processing = false;
  let stopped = false;
  let settledResolvers: Array<() => void> = [];

  function flushResolvers(): void {
    const resolvers = settledResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  function process(processEvent: CancellableProcessEventFn): void {
    if (processing) return;
    processing = true;
    try {
      while (index < queue.length) {
        if (stopped) break;
        const event = queue[index];
        index++;
        if (!processEvent(event)) {
          stopped = true;
          break;
        }
      }
    } finally {
      queue.length = 0;
      index = 0;
      processing = false;
      stopped = false;
      flushResolvers();
    }
  }

  return {
    get length(): number {
      return queue.length - index;
    },

    push(...events: InternalEvent[]): void {
      if (stopped) return;
      queue.push(...events);
    },

    clear(): void {
      queue.length = 0;
      index = 0;
      flushResolvers();
    },

    settled(): Promise<void> {
      if (queue.length - index === 0 && !processing) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        settledResolvers.push(resolve);
      });
    },

    processCancellable(processEvent: CancellableProcessEventFn): void {
      process(processEvent);
    },
  };
}
