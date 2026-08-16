/**
 * PINNED FIXTURE — websocket.
 *
 * Source: packages/examples/websocketConnection.actor.test.ts (`createWsActor`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + tests/fingerprints.test.ts) catches
 * upstream refactors that change the graph shape.
 *
 * Story: WebSocket reconnection manager with heartbeat and exponential
 * backoff. Deterministic: all timing on the VirtualClock.
 *
 *   disconnected → connecting → connected → reconnecting → permanentlyDisconnected
 *     ↑              ↗                ↘          ↙
 *                     (fail)     (heartbeat timeout)
 *
 * Reconnect backoff: 1000 * 2^retryCount; past maxRetries → 100ms timer →
 * MAX_RETRIES_REACHED.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { EffectInput, InternalEvent } from "@mantaq/core";

// Inlined copy of @mantaq/sugar withTimeout — pinned fixtures stay
// self-contained (no drift via sugar refactors).
function withTimeout<ActorContext>(
  ms: number,
  input: EffectInput<ActorContext>,
  event: () => InternalEvent,
): void {
  input.clock.setTimeout(
    ms,
    () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
    { signal: input.signal },
  );
}

const disconnectedState = state("disconnected")();
const connectingState = state("connecting")();
const connectedState = state("connected")();
const reconnectingState = state("reconnecting")();
const permanentlyDisconnectedState = state("permanentlyDisconnected")();

export const connect = event("CONNECT")<{ url: string }>();
export const disconnect = event("DISCONNECT")();
export const forceReconnect = event("FORCE_RECONNECT")();

const connectionEstablished = event("CONNECTION_ESTABLISHED")();
export const connectionFailed = event("CONNECTION_FAILED")<{ error: string }>();
const heartbeatTimeout = event("HEARTBEAT_TIMEOUT")();
const reconnectTimeout = event("RECONNECT_TIMEOUT")();
const maxRetriesReached = event("MAX_RETRIES_REACHED")();

type WsContext = {
  retryCount: number;
  maxRetries: number;
  url?: string;
  heartbeatInterval: number;
  error?: string;
};

export function createWsActor(clock?: VirtualClock, options?: { maxRetries?: number }) {
  const c = clock ?? new VirtualClock();
  const maxRetries = options?.maxRetries ?? 3;

  const actor = new Actor({
    inputs: [connect, disconnect, forceReconnect],
    outputs: [],
    internal: [
      connectionEstablished,
      connectionFailed,
      heartbeatTimeout,
      reconnectTimeout,
      maxRetriesReached,
    ],
    states: [
      disconnectedState,
      connectingState,
      connectedState,
      reconnectingState,
      permanentlyDisconnectedState,
    ],
    initial: disconnectedState,
    clock: c,
    context: {
      retryCount: 0,
      maxRetries,
      url: undefined,
      heartbeatInterval: 5000,
      error: undefined,
    } as WsContext,
    setup: (m) => {
      m.effect(connectingState, (input) =>
        withTimeout(500, input, () => connectionEstablished.create()),
      );
      m.effect(connectedState, (input) =>
        withTimeout(5000, input, () => heartbeatTimeout.create()),
      );
      m.effect(reconnectingState, ({ signal, context, emit, clock }) => {
        const s = context.get();
        if (s.retryCount >= s.maxRetries) {
          clock.setTimeout(100, () => {
            if (signal.aborted) return;
            emit(maxRetriesReached.create());
          });
        } else {
          const delay = 1000 * Math.pow(2, s.retryCount);
          clock.setTimeout(delay, () => {
            if (signal.aborted) return;
            emit(reconnectTimeout.create());
          });
        }
      });
      m.onAny(disconnect, () => ({ state: disconnectedState }));
      m.onAny(forceReconnect, (_event, opts) => {
        const s = opts!.context.get();
        s.retryCount = 0;
        opts!.context.set(s);
        return { state: reconnectingState };
      });
      m.on(disconnectedState, connect, (event, opts) => {
        const s = opts!.context.get();
        s.url = event.payload.url;
        s.retryCount = 0;
        opts!.context.set(s);
        return { state: connectingState };
      });
      m.on(connectingState, connectionEstablished, () => ({ state: connectedState }));
      m.on(connectingState, connectionFailed, (event, opts) => {
        const s = opts!.context.get();
        s.retryCount += 1;
        s.error = event.payload.error;
        opts!.context.set(s);
        return { state: reconnectingState };
      });
      m.on(connectedState, heartbeatTimeout, () => ({ state: reconnectingState }));
      m.on(reconnectingState, connectionEstablished, (_event, opts) => {
        const s = opts!.context.get();
        s.retryCount = 0;
        opts!.context.set(s);
        return { state: connectedState };
      });
      m.on(reconnectingState, reconnectTimeout, () => ({ state: connectingState }));
      m.on(reconnectingState, maxRetriesReached, () => ({ state: permanentlyDisconnectedState }));
      m.on(permanentlyDisconnectedState, connect, (event, opts) => {
        const s = opts!.context.get();
        s.url = event.payload.url;
        s.retryCount = 0;
        opts!.context.set(s);
        return { state: connectingState };
      });
    },
  });

  return { actor, clock: c };
}
