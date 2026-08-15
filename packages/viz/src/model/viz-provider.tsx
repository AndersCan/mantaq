/**
 * viz-provider — one subscription per actor, shared via context +
 * `useSyncExternalStore`.
 *
 * Contract (plan §6.4):
 * - the store skips the seeded `change` callback (Subscribers replays
 *   `(seed, seed)` on subscribe),
 * - listener exceptions are swallowed (the machine is never affected by a
 *   subscriber throwing),
 * - `getSnapshot` returns a cached snapshot ref — unchanged between events,
 *   so `useSyncExternalStore` does not re-render spuriously.
 */

import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { AnyActor, AnyEventRef, Clock, InternalEvent, Snapshot } from "@mantaq/core";
import { Either } from "@mantaq/utils";

export interface PendingTimer {
  id: number;
  deadline: number;
  ms: number;
  eventName?: string;
}

export interface VizStore {
  subscribe(this: void, onStoreChange: () => void): () => void;
  getSnapshot(this: void): Snapshot;
  /** Send an event to the actor. */
  send(this: void, event: AnyEventRef | InternalEvent): void;
  /** Advance the actor clock (no-op when the clock is not virtual). */
  advance(this: void, ms: number): void;
  /** Outstanding virtual timers (harness readiness gate). */
  pendingTimers(this: void): PendingTimer[];
  actor(this: void): AnyActor | undefined;
  dispose(this: void): void;
}

interface AdvanceableClock extends Clock {
  advance(ms: number): void;
  pendingTimers(): PendingTimer[];
}

export function createVizStore(actor: AnyActor): VizStore {
  let snapshot = actor.snapshot();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    listeners.forEach((fn) => {
      void Either.from(fn);
    });
  };

  const off = actor.on("change", (next, prev) => {
    // Subscribers replays (seed, seed) on subscribe — skip the seed.
    if (next === prev) return;
    snapshot = next;
    emit();
  });

  const subscribe = (onStoreChange: () => void): (() => void) => {
    listeners.add(onStoreChange);
    return () => {
      listeners.delete(onStoreChange);
    };
  };
  const getSnapshot = (): Snapshot => snapshot;
  const send = (event: AnyEventRef | InternalEvent): void => {
    actor.send(event);
  };
  const advance = (ms: number): void => {
    const clock = actor.clock as AdvanceableClock;
    if (typeof clock.advance === "function") clock.advance(ms);
  };
  const pendingTimers = (): PendingTimer[] => {
    const clock = actor.clock as AdvanceableClock;
    return typeof clock.pendingTimers === "function" ? clock.pendingTimers() : [];
  };
  const getActor = (): AnyActor | undefined => actor;
  const dispose = (): void => {
    off();
    listeners.clear();
  };

  return { subscribe, getSnapshot, send, advance, pendingTimers, actor: getActor, dispose };
}

const VizContext = createContext<VizStore | null>(null);

export interface VizProviderProps {
  actor: AnyActor;
  children: ReactNode;
}

export function VizProvider({ actor, children }: VizProviderProps): ReactNode {
  const store = useMemo(() => createVizStore(actor), [actor]);
  useEffect(() => () => store.dispose(), [store]);
  return <VizContext.Provider value={store}>{children}</VizContext.Provider>;
}

export function useVizStore(): VizStore {
  const store = useContext(VizContext);
  if (store === null) {
    throw new Error("[@mantaq/viz] useVizStore must be used inside <VizProvider>");
  }
  return store;
}
