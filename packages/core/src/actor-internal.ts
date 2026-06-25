import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, InternalEvent } from "./event.ts";
import type { Clock } from "./clock.ts";

export interface Snapshot {
  path: string[];
  regions: Record<string, Snapshot>;
  done?: boolean;
}

export interface AnyActor {
  state: AnyStateRef;
  clock: Clock;
  regions: Record<string, AnyActor>;
  send(event: AnyEventRef | InternalEvent): void;
  snapshot(): Snapshot;
  on(event: "change", fn: (snapshot: Snapshot) => void): () => void;
  on(event: "error", fn: (error: unknown) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  settled(): Promise<void>;
  context?: Record<string, unknown>;
  options?: {
    transitions?: Record<string, Record<string, unknown>>;
    states?: ReadonlyArray<{ name: string; isFinal: boolean }>;
  };
  __children: Map<string, AnyActor>;
  __outputHandler: ((event: InternalEvent) => void) | null;
  __pushInternal(event: InternalEvent): void;
  __drainInternal(): void;
  __abortEffects(): void;
}
