import type { AnyStateRef } from "./state.ts";
import type { InternalEvent } from "./event.ts";
import type { Clock } from "./clock.ts";
import type { LastKnownState } from "./actor-types.ts";
import type { EffectEntry } from "./builder.ts";
import type { Context } from "./context.ts";
import { Either } from "@mantaq/utils";

export interface EffectRunnerOptions<ActorContext> {
  effects: Record<string, Array<EffectEntry<ActorContext>>>;
  state: AnyStateRef;
  statePayload: unknown;
  event: InternalEvent;
  context: Context<ActorContext>;
  emit: (event: InternalEvent) => void;
  clock: Clock;
  abort: AbortController;
  lastGood: LastKnownState;
  onError: (error: unknown, lastGood: LastKnownState) => void;
}

export interface EffectRunResult {
  pending: Array<Promise<void>>;
  /** Names of effects invoked synchronously by this run, in registration order. */
  ran: string[];
}

export function runEffects<ActorContext>(
  options: EffectRunnerOptions<ActorContext>,
): EffectRunResult {
  const pending: Array<Promise<void>> = [];
  const ran: string[] = [];
  const list = options.effects[options.state.name];
  if (!list) return { pending, ran };

  for (const { name, fn } of list) {
    if (options.abort.signal.aborted) break;
    let out: unknown;
    const attempt = Either.from(() => {
      out = fn({
        signal: options.abort.signal,
        state: { name: options.state.name, payload: options.statePayload },
        event: options.event,
        context: options.context,
        emit: options.emit,
        clock: options.clock,
      });
      return true;
    });
    if (attempt[0] !== undefined) {
      options.onError(attempt[0], options.lastGood);
      break;
    }
    ran.push(name);
    // A native Promise or any thenable (custom implementation, e.g. a library
    // deferred) is an async effect: it must be awaited by settled(), have its
    // rejection handled (no unhandled rejection), and route to onError.
    // `Promise.resolve` adopts a custom thenable without re-wrapping a native
    // Promise.
    const isThenable =
      out instanceof Promise ||
      (typeof out === "object" &&
        out !== null &&
        typeof (out as { then?: unknown }).then === "function");
    if (isThenable) {
      // `Promise.resolve` adopts a custom thenable without re-wrapping a native
      // Promise. The rejection handler routes to onError (and is swallowed when
      // the effect was aborted), so a rejecting thenable can't become an
      // unhandled rejection.
      const effectPromise = Promise.resolve(out as Promise<unknown>).then(
        () => undefined,
        (error: unknown) => {
          if (options.abort.signal.aborted) return;
          options.onError(error, options.lastGood);
        },
      );
      pending.push(effectPromise);
    }
  }
  return { pending, ran };
}
