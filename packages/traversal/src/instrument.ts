import type { AnyActor, Snapshot, TransitionInfo } from "@mantaq/core";
import { History } from "./history.ts";

export interface InstrumentedActor<C = Record<string, unknown>> {
  history: History;
  send(event: unknown): void;
  state: AnyActor["state"];
  snapshot(): Snapshot<C>;
  regions: Record<string, AnyActor>;
  context?: C;
  clock: AnyActor["clock"];
  on(event: "change", fn: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void): () => void;
  on(event: "transition", fn: (info: TransitionInfo) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  recover(target: { state: AnyActor["state"]; context: C }): void;
  settled(): Promise<void>;
  options?: AnyActor["options"];
}

function wrapWithProxy<C>(actor: AnyActor<C>, history: History): InstrumentedActor<C> {
  const origSend = actor.send.bind(actor);

  return {
    get history() {
      return history;
    },
    get state() {
      return actor.state;
    },
    get regions() {
      return actor.regions;
    },
    get context() {
      return actor.context;
    },
    get clock() {
      return actor.clock;
    },
    get options() {
      return actor.options;
    },

    send(event: unknown) {
      trackSendEvent(history, event);
      origSend(event as Parameters<typeof origSend>[0]);
    },

    snapshot() {
      return actor.snapshot();
    },
    on: actor.on.bind(actor) as InstrumentedActor<C>["on"],
    recover: actor.recover.bind(actor),
    settled: actor.settled.bind(actor),
  };
}

function recordTransition(
  history: History,
  rec: {
    from: string;
    to: string;
    event: string;
    transitioned: boolean;
    effects: Record<string, unknown[]>;
  },
) {
  history.append({
    type: "transition",
    data: { from: rec.from, event: rec.event, to: rec.to, timestamp: Date.now() },
  });
  if (!rec.transitioned) return;
  history.append({
    type: "state_visit",
    data: { stateName: rec.to, timestamp: Date.now() },
  });
  if ((rec.effects[rec.to] ?? []).length > 0) {
    history.append({
      type: "effect",
      data: { stateName: rec.to, timestamp: Date.now() },
    });
  }
}

function trackSendEvent(history: History, event: unknown): void {
  const evt = event as { type?: string };
  const eventId = evt?.type ?? "unknown";
  history.append({
    type: "send",
    data: { event: eventId, timestamp: Date.now() },
  });
}

export function instrument<C>(actor: AnyActor<C>): InstrumentedActor<C> {
  const history = new History();

  history.append({
    type: "state_visit",
    data: { stateName: actor.state.name, timestamp: Date.now() },
  });

  const wrapped = wrapWithProxy(actor, history);

  const effectsByState = actor.options?.effects ?? {};
  actor.on("transition", ({ event, from, to, transitioned }) => {
    recordTransition(history, {
      from,
      to,
      event: event.type,
      transitioned,
      effects: effectsByState,
    });
  });

  return wrapped;
}
