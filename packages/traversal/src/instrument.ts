import { createHistory } from "./history.ts";
import type { History } from "./history.ts";
import type { AnyActor, ErrorInfo, InternalEvent, Snapshot, TransitionInfo } from "@mantaq/core";

type SubscriberEventName = "change" | "done" | "transition" | "error" | "output";

type SubscriberHandler<C, E extends SubscriberEventName> = E extends "change"
  ? (snapshot: Snapshot<C>, prev: Snapshot<C>) => void
  : E extends "done"
    ? () => void
    : E extends "transition"
      ? (info: TransitionInfo) => void
      : E extends "error"
        ? (info: ErrorInfo) => void
        : E extends "output"
          ? (event: InternalEvent) => void
          : never;

export interface InstrumentedActor<C = Record<string, unknown>> {
  history: History;
  send(event: InternalEvent): void;
  state: AnyActor["state"];
  snapshot(): Snapshot<C>;
  regions: Record<string, AnyActor>;
  context?: C;
  clock: AnyActor["clock"];
  on<E extends SubscriberEventName>(event: E, options: { fn: SubscriberHandler<C, E> }): () => void;
  recover(target: { state: AnyActor["state"]; context: C }): void;
  settled(): Promise<void>;
  options?: AnyActor["options"];
  inject(event: InternalEvent): void;
  dispose(): void;
}

function wrapWithProxy<C>(actor: AnyActor<C>, wrapped: { history: History }): InstrumentedActor<C> {
  function forwardOn<E extends SubscriberEventName>(
    event: E,
    options: { fn: SubscriberHandler<C, E> },
  ): () => void {
    return actor.on(event, options);
  }

  return {
    get history() {
      return wrapped.history;
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

    send(event) {
      trackSendEvent({ history: wrapped.history, sentEvent: event });
      actor.send(event);
    },

    snapshot() {
      return actor.snapshot();
    },
    on: forwardOn,
    inject: actor.inject.bind(actor),
    dispose: actor.dispose.bind(actor),
    recover: actor.recover.bind(actor),
    settled: actor.settled.bind(actor),
  };
}

function recordTransition(recorder: {
  history: History;
  record: {
    from: string;
    to: string;
    event: string;
    transitioned: boolean;
    effectNames: string[];
  };
}): void {
  recorder.history.append({
    type: "transition",
    data: { from: recorder.record.from, event: recorder.record.event, to: recorder.record.to },
  });
  if (!recorder.record.transitioned) return;
  recorder.history.append({
    type: "state_visit",
    data: { stateName: recorder.record.to },
  });
  for (const effectName of recorder.record.effectNames) {
    recorder.history.append({
      type: "effect",
      data: { stateName: recorder.record.to, effectName },
    });
  }
}

function trackSendEvent(tracking: { history: History; sentEvent: unknown }): void {
  const eventType =
    typeof tracking.sentEvent === "object" &&
    tracking.sentEvent !== null &&
    "type" in tracking.sentEvent
      ? tracking.sentEvent.type
      : "unknown";
  tracking.history.append({
    type: "send",
    data: { event: String(eventType) },
  });
}

function prefixId(identity: { prefix: string; name: string }): string {
  return identity.prefix ? `${identity.prefix}.${identity.name}` : identity.name;
}

export function instrument<C>(actor: AnyActor<C>): InstrumentedActor<C> {
  const history = createHistory();
  const wrapped = wrapWithProxy(actor, { history });
  attach(actor, { history, prefix: "" });
  return wrapped;
}

function attach(childActor: AnyActor<unknown>, branch: { history: History; prefix: string }): void {
  branch.history.append({
    type: "state_visit",
    data: { stateName: prefixId({ prefix: branch.prefix, name: childActor.state.name }) },
  });

  childActor.on("transition", {
    fn: ({ event, from, to, transitioned, effects }) => {
      recordTransition({
        history: branch.history,
        record: {
          from: prefixId({ prefix: branch.prefix, name: from }),
          to: prefixId({ prefix: branch.prefix, name: to }),
          event: event.type,
          transitioned,
          effectNames: effects,
        },
      });
    },
  });

  for (const [regionName, regionChild] of Object.entries(childActor.regions ?? {})) {
    attach(regionChild, {
      history: branch.history,
      prefix: prefixId({ prefix: branch.prefix, name: regionName }),
    });
  }
}
