import type { AnyActor, ErrorInfo, InternalEvent, Snapshot, TransitionInfo } from "@mantaq/core";
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
  on(event: "error", fn: (info: ErrorInfo) => void): () => void;
  on(event: "output", fn: (event: InternalEvent) => void): () => void;
  recover(target: { state: AnyActor["state"]; context: C }): void;
  settled(): Promise<void>;
  options?: AnyActor["options"];
  inject(event: InternalEvent): void;
  dispose(): void;
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
    inject: actor.inject.bind(actor),
    dispose: actor.dispose.bind(actor),
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
    effectNames: string[];
  },
) {
  history.append({
    type: "transition",
    data: { from: rec.from, event: rec.event, to: rec.to },
  });
  if (!rec.transitioned) return;
  history.append({
    type: "state_visit",
    data: { stateName: rec.to },
  });
  for (const effectName of rec.effectNames) {
    history.append({
      type: "effect",
      data: { stateName: rec.to, effectName },
    });
  }
}

function trackSendEvent(history: History, event: unknown): void {
  const evt = event as { type?: string };
  const eventId = evt?.type ?? "unknown";
  history.append({
    type: "send",
    data: { event: eventId },
  });
}

function prefixId(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

export function instrument<C>(actor: AnyActor<C>): InstrumentedActor<C> {
  const history = new History();
  const wrapped = wrapWithProxy(actor, history);
  attach<C>(actor, history, "");
  return wrapped;
}

function attach<C>(actor: AnyActor<C>, history: History, prefix: string): void {
  history.append({
    type: "state_visit",
    data: { stateName: prefixId(prefix, actor.state.name) },
  });

  actor.on("transition", ({ event, from, to, transitioned, effects }) => {
    recordTransition(history, {
      from: prefixId(prefix, from),
      to: prefixId(prefix, to),
      event: event.type,
      transitioned,
      effectNames: effects,
    });
  });

  for (const [regionName, child] of Object.entries(actor.regions ?? {})) {
    attach(child, history, prefixId(prefix, regionName));
  }
}
