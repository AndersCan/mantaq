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
        // Stryker disable next-line ConditionalExpression -- `stopped` is only ever set true on the line below and reset in `finally`, so it is always false at this guard; inverting it never changes an observable result.
        if (stopped) break;
        const event = queue[index];
        index++;
        if (!processEvent(event)) {
          // Stryker disable next-line BooleanLiteral -- the value is reset in `finally` before any external read, so setting it false here is indistinguishable.
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
      // Stryker disable next-line ConditionalExpression -- `stopped` is reset to false in `finally` after every `process`, so it is never true when `push` is called externally; inverting the guard is unreachable.
      if (stopped) return;
      queue.push(...events);
    },

    clear(): void {
      queue.length = 0;
      index = 0;
      flushResolvers();
    },

    settled(): Promise<void> {
      // Stryker disable next-line ArithmeticOperator -- when not processing, `index` is always 0 (reset in `finally`), so `length - index` and `length + index` are equal; the guard is unchanged.
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
