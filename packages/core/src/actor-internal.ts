import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, InternalEvent } from "./event.ts";
import type { Clock } from "./clock.ts";
import type { ErrorInfo, TransitionInfo } from "./actor-types.ts";

export interface Snapshot<C = unknown> {
  path: string[];
  context: C;
  payload?: unknown;
  regions: Record<string, Snapshot<unknown>>;
  done?: boolean;
  error?: ErrorInfo;
}

export interface AnyActor<C = Record<string, unknown>> {
  state: AnyStateRef;
  clock: Clock;
  regions: Record<string, AnyActor>;
  send(event: AnyEventRef | InternalEvent): void;
  snapshot(): Snapshot<C>;
  on(event: "change", fn: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  on(event: "transition", fn: (info: TransitionInfo) => void): () => void;
  recover(target: { state: AnyStateRef; context: C }): void;
  settled(): Promise<void>;
  context?: C;
  options?: {
    transitions?: Record<string, Record<string, unknown>>;
    effects?: Record<string, unknown[]>;
    states?: ReadonlyArray<{ name: string; isFinal: boolean }>;
  };
}
