import type { AnyActor, Snapshot, InternalEvent } from "@mantaq/core";
import { History } from "./history.ts";

export interface InstrumentedActor {
  history: History;
  send(event: unknown): void;
  state: AnyActor["state"];
  snapshot(): Snapshot;
  regions: Record<string, AnyActor>;
  context?: Record<string, unknown>;
  clock: AnyActor["clock"];
  on(event: "change", fn: (snapshot: Snapshot) => void): () => void;
  on(event: "error", fn: (error: unknown) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  settled(): Promise<void>;
  options?: AnyActor["options"];
  __children: Map<string, AnyActor>;
  __outputHandler: ((event: InternalEvent) => void) | null;
  __pushInternal(event: InternalEvent): void;
  __drainInternal(): void;
  __abortEffects(): void;
}

export function instrument(actor: AnyActor): InstrumentedActor {
  const history = new History();
  const origSend = actor.send.bind(actor);
  let prevStateName = actor.state.name;
  let pendingEventId: string | undefined;

  history.append({
    type: "state_visit",
    data: { stateName: actor.state.name, timestamp: Date.now() },
  });

  const wrapped: InstrumentedActor = {
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
    get __children() {
      return actor.__children;
    },
    get __outputHandler() {
      return actor.__outputHandler;
    },
    set __outputHandler(fn) {
      actor.__outputHandler = fn;
    },

    send(event: unknown) {
      const evt = event as { id?: string };
      const eventId = evt?.id ?? "unknown";
      history.append({
        type: "send",
        data: { event: eventId, timestamp: Date.now() },
      });

      pendingEventId = eventId;
      try {
        origSend(event as Parameters<typeof origSend>[0]);
      } finally {
        pendingEventId = undefined;
      }
    },

    snapshot() {
      return actor.snapshot();
    },
    on: actor.on.bind(actor) as InstrumentedActor["on"],
    settled: actor.settled.bind(actor),
    __pushInternal: actor.__pushInternal.bind(actor),
    __drainInternal() {
      actor.__drainInternal();
    },
    __abortEffects: actor.__abortEffects.bind(actor),
  };

  actor.on("change", () => {
    const currentName = actor.state.name;
    if (currentName !== prevStateName) {
      history.append({
        type: "transition",
        data: {
          from: prevStateName,
          event: pendingEventId ?? "unknown",
          to: currentName,
          timestamp: Date.now(),
        },
      });
      history.append({
        type: "state_visit",
        data: { stateName: currentName, timestamp: Date.now() },
      });
      history.append({
        type: "effect",
        data: { stateName: currentName, timestamp: Date.now() },
      });
      prevStateName = currentName;
    }
  });

  return wrapped;
}
