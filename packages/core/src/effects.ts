import type { AnyStateRef } from "./state.ts";
import type { InternalEvent } from "./event.ts";
import type { Clock } from "./clock.ts";
import type { EffectFn } from "./actor-types.ts";
import type { Context } from "./context.ts";

export interface EffectRunnerOptions<ActorContext> {
  effects: Record<string, Array<EffectFn<ActorContext>>>;
  state: AnyStateRef;
  statePayload: unknown;
  event: InternalEvent;
  context: Context<ActorContext>;
  emit: (event: InternalEvent) => void;
  clock: Clock;
}

export function runEffects<ActorContext>(
  options: EffectRunnerOptions<ActorContext>,
): AbortController | null {
  if (options.state.isFinal) return null;
  const list = options.effects[options.state.name];
  if (!list || list.length === 0) return null;

  const abort = new AbortController();
  for (const effectFn of list) {
    effectFn({
      signal: abort.signal,
      state: { name: options.state.name, payload: options.statePayload },
      event: options.event,
      context: options.context,
      emit: options.emit,
      clock: options.clock,
    });
  }
  return abort;
}
