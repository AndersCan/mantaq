import type { ErrorInfo, TransitionInfo } from "./actor-types.ts";
import type { Clock } from "./clock.ts";
import type { InternalEvent } from "./index.ts";
import type { AnyStateRef } from "./state.ts";

export interface Snapshot<C = unknown> {
  path: string[];
  context: C;
  payload?: unknown;
  regions: Record<string, Snapshot<unknown>>;
  done?: boolean;
  error?: ErrorInfo;
}

export type SubscriberEventName = "change" | "done" | "transition" | "error" | "output";

export type SubscriberHandler<C, E extends SubscriberEventName> = E extends "change"
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

export interface AnyActor<C = Record<string, unknown>> {
  state: AnyStateRef;
  clock: Clock;
  regions: Record<string, AnyActor>;
  send(event: InternalEvent): void;
  snapshot(): Snapshot<C>;
  on<E extends SubscriberEventName>(event: E, options: { fn: SubscriberHandler<C, E> }): () => void;
  recover(target: { state: AnyStateRef; context: C }): void;
  settled(): Promise<void>;
  context?: C;
  options?: {
    transitions?: Record<string, Record<string, unknown>>;
    effects?: Record<string, unknown[]>;
    states?: ReadonlyArray<{ name: string; isFinal: boolean }>;
  };
  inject(event: InternalEvent): void;
  dispose(): void;
}
