import type { VizEdge, VizJson, VizMachine, VizStep } from "./schema.ts";
/**
 * `input`: sent from outside. `effect`: sent by an effect of the current
 * state (its `sends` list). `internal`: any other internal event (another
 * actor, a timer the effect did not declare, a test injecting it).
 */
export type MoveGroup = "input" | "effect" | "internal";
export interface Move {
  edge: VizEdge;
  /** States this edge can lead to; several for an undetermined edge, none when unknown. */
  targets: string[];
  group: MoveGroup;
  /** Effects of the current state whose `sends` list this event. */
  sentBy: string[];
}
/**
 * Every edge an event can take out of `state`: its own registrations and the
 * `onAny` ones. A final state has none: the actor has stopped.
 */
export declare function movesFrom(machine: VizMachine, state: string): Move[];
/** Events an effect of `state` declares in `sends` that no handler in `state` takes. */
export declare function unhandledSends(
  machine: VizMachine,
  state: string,
): Array<{
  effect: string;
  event: string;
}>;
/**
 * A live step as text for a URL: `@800` advances the clock 800 ms, `go` sends
 * `go` with no payload, `pay={"amount":5}` sends `pay` with a JSON payload.
 */
export declare function encodeLiveStep(step: VizStep): string;
/** Steps from a shared link, up to the first one that does not parse. */
export declare function decodeLiveSteps(encoded: ReadonlyArray<string>): VizStep[];
/** Distinct payloads the fuzzer sent with `event`, in first-seen order. */
export declare function payloadSamples(machine: VizMachine, event: string): VizJson[];
/** True when sending `event` should ask first: it declares a payload type, or fuzzing sent it data beyond `{}` (core turns a missing payload into `{}`). */
export declare function asksForPayload(machine: VizMachine, event: string): boolean;
