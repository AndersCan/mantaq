import type { AnyStateRef } from "./state.ts";
import type { InternalEvent } from "./event.ts";
import type { Clock } from "./clock.ts";
import type { EffectFn, LastKnownState } from "./actor-types.ts";
import type { Context } from "./context.ts";
import { Either } from "@mantaq/utils";

export interface EffectRunnerOptions<ActorContext> {
  effects: Record<string, Array<EffectFn<ActorContext>>>;
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
}

export function runEffects<ActorContext>(
  options: EffectRunnerOptions<ActorContext>,
): EffectRunResult {
  const pending: Array<Promise<void>> = [];
  const list = options.effects[options.state.name];
  if (!list) return { pending };

  for (const effectFn of list) {
    if (options.abort.signal.aborted) break;
    let out: unknown;
    const attempt = Either.from(() => {
      out = effectFn({
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
    if (out instanceof Promise) {
      pending.push(
        out.catch((error: unknown) => {
          if (options.abort.signal.aborted) return;
          options.onError(error, options.lastGood);
        }),
      );
    }
  }
  return { pending };
}
