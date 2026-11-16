import { Either } from "@mantaq/utils";
import { coveredByAny } from "./schema.ts";
import type { VizActorRef, VizEdge, VizJson, VizMachine, VizStep } from "./schema.ts";

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

const GROUP_ORDER: Record<MoveGroup, number> = { input: 0, effect: 1, internal: 2 };

function targetsOf(edge: VizEdge, current: string): string[] {
  if (edge.kind === "stay") return [current];
  if (edge.to !== null) return [edge.to];
  if (edge.explanation?.status !== "analyzed") return [];
  const targets = edge.explanation.branches.flatMap((branch) => {
    if (branch.target.kind === "state") return [branch.target.state];
    return branch.target.kind === "stay" ? [current] : [];
  });
  return [...new Set(targets)].sort();
}

function sendersOf(machine: VizMachine, state: string): Map<string, string[]> {
  const senders = new Map<string, string[]>();
  const effects = machine.states.find((each) => each.id === state)?.effects ?? [];
  for (const effect of effects) {
    for (const sent of effect.sends ?? []) {
      senders.set(sent, [...(senders.get(sent) ?? []), effect.name]);
    }
  }
  return senders;
}

/**
 * Every edge an event can take out of `state`: its own registrations and the
 * `onAny` ones. A final state has none: the actor has stopped.
 */
export function movesFrom(machine: VizMachine, state: string): Move[] {
  const current = machine.states.find((each) => each.id === state);
  if (current === undefined || current.final) return [];
  const internal = new Set(machine.events.filter((each) => each.internal).map((each) => each.id));
  const senders = sendersOf(machine, state);
  return machine.edges
    .filter(
      (edge) =>
        (edge.kind === "transition" || edge.kind === "stay") &&
        (edge.from === state || coveredByAny(edge.from, state)),
    )
    .map((edge): Move => {
      const sentBy = senders.get(edge.event) ?? [];
      const group: MoveGroup = !internal.has(edge.event)
        ? "input"
        : sentBy.length > 0
          ? "effect"
          : "internal";
      return { edge, targets: targetsOf(edge, state), group, sentBy };
    })
    .sort(
      (left, right) =>
        GROUP_ORDER[left.group] - GROUP_ORDER[right.group] ||
        left.edge.event.localeCompare(right.edge.event) ||
        left.edge.id.localeCompare(right.edge.id),
    );
}

/** Events an effect of `state` declares in `sends` that no handler in `state` takes. */
export function unhandledSends(
  machine: VizMachine,
  state: string,
): Array<{ effect: string; event: string }> {
  const handled = new Set(movesFrom(machine, state).map((move) => move.edge.event));
  const effects = machine.states.find((each) => each.id === state)?.effects ?? [];
  return effects.flatMap((effect) =>
    (effect.sends ?? [])
      .filter((event) => !handled.has(event))
      .map((event) => ({ effect: effect.name, event })),
  );
}

/**
 * A live step as text for a URL: `@800` advances the clock 800 ms, `go` sends
 * `go` with no payload, `pay={"amount":5}` sends `pay` with a JSON payload.
 */
export function encodeLiveStep(step: VizStep): string {
  if (step.kind === "advance") return `@${step.ms}`;
  const event = step.actor === undefined ? step.event : `${actorText(step.actor)}>${step.event}`;
  return step.payload === null ? event : `${event}=${JSON.stringify(step.payload)}`;
}

/** The URL prefix of an actor ref: the region path, or `map[key]` with the key encoded. */
function actorText(actor: VizActorRef): string {
  return "region" in actor ? actor.region : `${actor.map}[${encodeURIComponent(actor.key)}]`;
}

const CHILD = /^([^[\]>]+)\[([^\]]*)\]$/;

function decodeActor(text: string): VizActorRef | null {
  const child = CHILD.exec(text);
  if (child === null) return { region: text };
  const key = Either.from(() => decodeURIComponent(child[2] ?? ""));
  return Either.isLeft(key) ? null : { map: child[1] ?? "", key: key[1] };
}

function parseJson(text: string): { value: VizJson } | null {
  try {
    return { value: JSON.parse(text) as VizJson };
  } catch {
    return null;
  }
}

/** The `[actor>]event` part of a step's text. */
function decodeHead(head: string): { event: string; actor: { actor?: VizActorRef } } | null {
  const arrow = head.indexOf(">");
  const event = arrow === -1 ? head : head.slice(arrow + 1);
  if (event === "" || arrow === 0) return null;
  if (arrow === -1) return { event, actor: {} };
  const ref = decodeActor(head.slice(0, arrow));
  return ref === null ? null : { event, actor: { actor: ref } };
}

/** Inverse of `encodeLiveStep`; null when the text is not a step. */
function decodeLiveStep(text: string): VizStep | null {
  if (text.startsWith("@")) {
    const ms = Number(text.slice(1));
    return text.length > 1 && Number.isFinite(ms) && ms >= 0 ? { kind: "advance", ms } : null;
  }
  const cut = text.indexOf("=");
  const head = decodeHead(cut === -1 ? text : text.slice(0, cut));
  if (head === null) return null;
  const { event, actor } = head;
  if (cut === -1) return { kind: "event", event, payload: null, ...actor };
  const payload = parseJson(text.slice(cut + 1));
  return payload === null ? null : { kind: "event", event, payload: payload.value, ...actor };
}

/** Steps from a shared link, up to the first one that does not parse. */
export function decodeLiveSteps(encoded: ReadonlyArray<string>): VizStep[] {
  const steps: VizStep[] = [];
  for (const text of encoded) {
    const step = decodeLiveStep(text);
    if (step === null) break;
    steps.push(step);
  }
  return steps;
}

/** Distinct payloads the fuzzer sent with `event`, in first-seen order. */
export function payloadSamples(machine: VizMachine, event: string): VizJson[] {
  const steps = [
    ...(machine.fuzz?.corpus.flatMap((sequence) => sequence.steps) ?? []),
    ...(machine.fuzz?.errors.flatMap((error) => error.steps) ?? []),
  ];
  const seen = new Map<string, VizJson>();
  for (const step of steps) {
    if (step.kind !== "event" || step.event !== event || step.payload === null) continue;
    seen.set(JSON.stringify(step.payload), step.payload);
  }
  return [...seen.values()];
}

/** True when sending `event` should ask first: it declares a payload type, or fuzzing sent it data beyond `{}` (core turns a missing payload into `{}`). */
export function asksForPayload(machine: VizMachine, event: string): boolean {
  const fields = machine.events.find((each) => each.id === event)?.payload ?? null;
  const samples = payloadSamples(machine, event);
  if (fields !== null) return fields.length > 0 || samples.length > 0;
  return samples.some((sample) => !isEmptyObject(sample));
}

function isEmptyObject(value: VizJson): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
