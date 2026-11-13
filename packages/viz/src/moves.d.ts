import type { VizEdge, VizJson, VizMachine, VizStep } from "./schema.ts";
/**
 * Walking the drawn graph by hand: no actor runs. A path is the edges taken
 * from the initial state, each with the state it led to. Guards are not
 * evaluated, so a path shows what the declarations allow, not what a run does.
 */
export interface ExploreStep {
  edge: string;
  to: string;
}
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
/** Where a path ends: the last step's target, or the initial state. */
export declare function stateAfter(
  machine: VizMachine,
  path: ReadonlyArray<ExploreStep>,
): string | null;
/** Events an effect of `state` declares in `sends` that no handler in `state` takes. */
export declare function unhandledSends(
  machine: VizMachine,
  state: string,
): Array<{
  effect: string;
  event: string;
}>;
/** One step as text for a URL: the edge id, plus `~target` when the edge has no single target. */
export declare function encodeStep(machine: VizMachine, step: ExploreStep): string;
/**
 * Rebuild a path from encoded steps (e.g. `?step=` in a shared link). Stops at
 * the first step the graph does not allow from where the path has got to, so
 * a link from an older document still opens at its last valid point.
 */
export declare function decodePath(
  machine: VizMachine,
  encoded: ReadonlyArray<string>,
): ExploreStep[];
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
