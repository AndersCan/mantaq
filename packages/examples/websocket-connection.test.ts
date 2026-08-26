/**
 * WebSocket reconnection manager modeled as an actor.
 *
 * States: disconnected, connecting, connected, reconnecting, permanentlyDisconnected
 *
 * Demonstrates:
 *   - State machine with 5 states and complex transition rules
 *   - Async effects with timeout (connection attempt, heartbeat)
 *   - Conditional effect logic (exponential backoff vs max retries)
 *   - Any handlers for intercepting events across all states
 *   - Context mutation for retry count and error tracking
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

function inject(actor: AnyActor, event: { type: string }): void {
  actor.inject(event);
}

// ── State refs ──────────────────────────────────────────────────────
const disconnectedState = state("disconnected")();
const connectingState = state("connecting")();
const connectedState = state("connected")();
const reconnectingState = state("reconnecting")();
const permanentlyDisconnectedState = state("permanentlyDisconnected")();

// ── Input events (external) ─────────────────────────────────────────
const connect = event("CONNECT")<{ url: string }>();
const disconnect = event("DISCONNECT")();
const forceReconnect = event("FORCE_RECONNECT")();

// ── Internal events (from effects) ──────────────────────────────────
const connectionEstablished = event("CONNECTION_ESTABLISHED")();
const connectionFailed = event("CONNECTION_FAILED")<{ error: string }>();
const heartbeatTimeout = event("HEARTBEAT_TIMEOUT")();
const reconnectTimeout = event("RECONNECT_TIMEOUT")();
const maxRetriesReached = event("MAX_RETRIES_REACHED")();

// ── Context ─────────────────────────────────────────────────────────
type WsContext = {
  retryCount: number;
  maxRetries: number;
  url?: string;
  heartbeatInterval: number;
  error?: string;
};

// ── Actor factory ───────────────────────────────────────────────────
function createWsActor(clock?: VirtualClock, options?: { maxRetries?: number }) {
  const c = clock ?? VirtualClock();
  const maxRetries = options?.maxRetries ?? 3;

  const initialContext: WsContext = {
    retryCount: 0,
    maxRetries,
    heartbeatInterval: 5000,
  };

  const actor = Actor({
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
    context: initialContext,
    setup: (m) => {
      m.effect(connectingState, {
        name: "timeConnect",
        fn: (input) =>
          withTimeout(500, { input: input, event: () => ({ type: "CONNECTION_ESTABLISHED" }) }),
      });
      m.effect(connectedState, {
        name: "startHeartbeatTimer",
        fn: (input) =>
          withTimeout(5000, { input: input, event: () => ({ type: "HEARTBEAT_TIMEOUT" }) }),
      });
      m.effect(reconnectingState, {
        name: "scheduleReconnect",
        fn: ({ signal, context, emit, clock }) => {
          const current = context.get();
          if (current.retryCount >= current.maxRetries) {
            clock.setTimeout(100, {
              cb: () => {
                if (signal.aborted) return;
                emit({ type: "MAX_RETRIES_REACHED" });
              },
            });
          } else {
            const delay = 1000 * Math.pow(2, current.retryCount);
            clock.setTimeout(delay, {
              cb: () => {
                if (signal.aborted) return;
                emit({ type: "RECONNECT_TIMEOUT" });
              },
            });
          }
        },
      });
      m.onAny({ eventRef: disconnect, handler: () => ({ state: disconnectedState }) });
      m.onAny({
        eventRef: forceReconnect,
        handler: (_event, { context }) => {
          const current = context.get();
          current.retryCount = 0;
          context.set(current);
          return { state: reconnectingState };
        },
      });
      m.on(disconnectedState, {
        eventRef: connect,
        handler: (event, { context }) => {
          const current = context.get();
          current.url = event.payload.url;
          current.retryCount = 0;
          context.set(current);
          return { state: connectingState };
        },
      });
      m.on(connectingState, {
        eventRef: connectionEstablished,
        handler: () => ({ state: connectedState }),
      });
      m.on(connectingState, {
        eventRef: connectionFailed,
        handler: (event, { context }) => {
          const current = context.get();
          current.retryCount += 1;
          current.error = event.payload.error;
          context.set(current);
          return { state: reconnectingState };
        },
      });
      m.on(connectedState, {
        eventRef: heartbeatTimeout,
        handler: () => ({ state: reconnectingState }),
      });
      m.on(reconnectingState, {
        eventRef: connectionEstablished,
        handler: (_event, { context }) => {
          const current = context.get();
          current.retryCount = 0;
          context.set(current);
          return { state: connectedState };
        },
      });
      m.on(reconnectingState, {
        eventRef: reconnectTimeout,
        handler: () => ({ state: connectingState }),
      });
      m.on(reconnectingState, {
        eventRef: maxRetriesReached,
        handler: () => ({ state: permanentlyDisconnectedState }),
      });
      m.on(permanentlyDisconnectedState, {
        eventRef: connect,
        handler: (event, { context }) => {
          const current = context.get();
          current.url = event.payload.url;
          current.retryCount = 0;
          context.set(current);
          return { state: connectingState };
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ───────────────────────────────────────────────────────────
describe("WebSocket reconnection manager", () => {
  it("sets disconnected as the initial state", () => {
    const { actor } = createWsActor();
    expect(matches(actor, "disconnected")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("sets connected after the connection establishes from CONNECT", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    expect({
      matches: matches(actor, "connecting"),
      url: actor.context.url,
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, url: "ws://example.com", retryCount: 0 });

    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);
  });

  it("updates state to reconnecting when the connection fails", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);

    clock.advance(200);
    expect(matches(actor, "connecting")).toBe(true);
    inject(actor, connectionFailed.create({ error: "Connection refused" }));
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
      error: actor.context.error,
    }).toEqual({ matches: true, retryCount: 1, error: "Connection refused" });
  });

  it("sets permanentlyDisconnected when failures exceed maxRetries", () => {
    const { actor, clock } = createWsActor(undefined, { maxRetries: 2 });

    // First attempt
    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);

    // Fail attempt 1
    inject(actor, connectionFailed.create({ error: "Error 1" }));
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 1 });

    // Backoff: 1000 * 2^1 = 2000ms → RECONNECT_TIMEOUT → connecting
    clock.advance(2000);
    expect(matches(actor, "connecting")).toBe(true);

    // Fail attempt 2 → retryCount=2, which equals maxRetries=2
    inject(actor, connectionFailed.create({ error: "Error 2" }));
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 2 });

    // retryCount >= maxRetries → MAX_RETRIES_REACHED after 100ms
    clock.advance(100);
    expect(matches(actor, "permanentlyDisconnected")).toBe(true);
  });

  it("returns to disconnected when DISCONNECT fires while connected", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(disconnect.create());
    expect(matches(actor, "disconnected")).toBe(true);
  });

  it("updates state to reconnecting on heartbeat timeout", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    // Heartbeat timeout is 5000ms
    clock.advance(5000);
    expect(matches(actor, "reconnecting")).toBe(true);
  });

  it("creates a reconnecting state when FORCE_RECONNECT fires while disconnected", () => {
    const { actor } = createWsActor();

    expect(matches(actor, "disconnected")).toBe(true);

    actor.send(forceReconnect.create());
    expect(matches(actor, "reconnecting")).toBe(true);
  });

  it("removes accumulated retries when FORCE_RECONNECT fires while connected", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(forceReconnect.create());
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 0 });
  });

  it("skips the backoff delay after FORCE_RECONNECT while reconnecting", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    inject(actor, connectionFailed.create({ error: "Fail" }));
    expect(actor.context.retryCount).toBe(1);

    // Force reconnect resets retryCount to 0
    actor.send(forceReconnect.create());
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 0 });

    // Backoff should now be 1000 * 2^0 = 1000ms (not 2000ms)
    clock.advance(1000);
    expect(matches(actor, "connecting")).toBe(true);
  });

  it("handles the full connect, disconnect, reconnect, succeed cycle", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(disconnect.create());
    expect(matches(actor, "disconnected")).toBe(true);

    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);

    clock.advance(500);
    expect({
      matches: matches(actor, "connected"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 0 });
  });

  it("keeps the retry count across backoff until success", () => {
    const { actor, clock } = createWsActor();

    // Attempt and fail
    actor.send(connect.create({ url: "ws://example.com" }));
    inject(actor, connectionFailed.create({ error: "Timeout" }));
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 1 });

    // Backoff: 1000 * 2^1 = 2000ms
    clock.advance(2000);
    expect(matches(actor, "connecting")).toBe(true);

    // This time it succeeds
    clock.advance(500);
    expect({
      matches: matches(actor, "connected"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 1 }); // not reset because we didn't reconnect from reconnecting
  });
});
