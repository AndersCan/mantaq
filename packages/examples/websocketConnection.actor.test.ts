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

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";

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
        withTimeout(500, input, () => ({ id: "CONNECTION_ESTABLISHED" })),
      );
      m.effect(connectedState, (input) =>
        withTimeout(5000, input, () => ({ id: "HEARTBEAT_TIMEOUT" })),
      );
      m.effect(reconnectingState, ({ signal, context, emit, clock }) => {
        const ctx = context as WsContext;
        if (ctx.retryCount >= ctx.maxRetries) {
          clock.setTimeout(100, () => {
            if (signal.aborted) return;
            emit({ id: "MAX_RETRIES_REACHED" });
          });
        } else {
          const delay = 1000 * Math.pow(2, ctx.retryCount);
          clock.setTimeout(delay, () => {
            if (signal.aborted) return;
            emit({ id: "RECONNECT_TIMEOUT" });
          });
        }
      });
      m.onAny(disconnect, () => ({ state: disconnectedState }));
      m.onAny(forceReconnect, (_event, opts) => {
        opts!.context.retryCount = 0;
        return { state: reconnectingState };
      });
      m.on(disconnectedState, connect, (event, opts) => {
        opts!.context.url = event.url;
        opts!.context.retryCount = 0;
        return { state: connectingState };
      });
      m.on(connectingState, connectionEstablished, () => ({ state: connectedState }));
      m.on(connectingState, connectionFailed, (event, opts) => {
        opts!.context.retryCount++;
        opts!.context.error = event.error;
        return { state: reconnectingState };
      });
      m.on(connectedState, heartbeatTimeout, () => ({ state: reconnectingState }));
      m.on(reconnectingState, connectionEstablished, (_event, opts) => {
        opts!.context.retryCount = 0;
        return { state: connectedState };
      });
      m.on(reconnectingState, reconnectTimeout, () => ({ state: connectingState }));
      m.on(reconnectingState, maxRetriesReached, () => ({ state: permanentlyDisconnectedState }));
      m.on(permanentlyDisconnectedState, connect, (event, opts) => {
        opts!.context.url = event.url;
        opts!.context.retryCount = 0;
        return { state: connectingState };
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ───────────────────────────────────────────────────────────
describe("WebSocket reconnection manager", () => {
  it("starts in disconnected state", () => {
    const { actor } = createWsActor();
    expect(matches(actor, "disconnected")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("CONNECT → connecting → connected (success path)", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);
    expect(actor.context.url).toBe("ws://example.com");
    expect(actor.context.retryCount).toBe(0);

    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);
  });

  it("CONNECT → connecting → reconnecting (connection failure)", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);

    clock.advance(200);
    expect(matches(actor, "connecting")).toBe(true);

    actor.__pushInternal(connectionFailed.create({ error: "Connection refused" }));
    actor.__drainInternal();
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(1);
    expect(actor.context.error).toBe("Connection refused");
  });

  it("exceeds maxRetries → permanentlyDisconnected", () => {
    const { actor, clock } = createWsActor(undefined, { maxRetries: 2 });

    // First attempt
    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);

    // Fail attempt 1
    actor.__pushInternal(connectionFailed.create({ error: "Error 1" }));
    actor.__drainInternal();
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(1);

    // Backoff: 1000 * 2^1 = 2000ms → RECONNECT_TIMEOUT → connecting
    clock.advance(2000);
    expect(matches(actor, "connecting")).toBe(true);

    // Fail attempt 2 → retryCount=2, which equals maxRetries=2
    actor.__pushInternal(connectionFailed.create({ error: "Error 2" }));
    actor.__drainInternal();
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(2);

    // retryCount >= maxRetries → MAX_RETRIES_REACHED after 100ms
    clock.advance(100);
    expect(matches(actor, "permanentlyDisconnected")).toBe(true);
  });

  it("DISCONNECT from connected → disconnected", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(disconnect.create());
    expect(matches(actor, "disconnected")).toBe(true);
  });

  it("heartbeat timeout → reconnecting", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    // Heartbeat timeout is 5000ms
    clock.advance(5000);
    expect(matches(actor, "reconnecting")).toBe(true);
  });

  it("FORCE_RECONNECT from disconnected → reconnecting", () => {
    const { actor } = createWsActor();

    expect(matches(actor, "disconnected")).toBe(true);

    actor.send(forceReconnect.create());
    expect(matches(actor, "reconnecting")).toBe(true);
  });

  it("FORCE_RECONNECT from connected → reconnecting with retryCount reset", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(forceReconnect.create());
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("FORCE_RECONNECT from reconnecting resets backoff", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    actor.__pushInternal(connectionFailed.create({ error: "Fail" }));
    actor.__drainInternal();
    expect(actor.context.retryCount).toBe(1);

    // Force reconnect resets retryCount to 0
    actor.send(forceReconnect.create());
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(0);

    // Backoff should now be 1000 * 2^0 = 1000ms (not 2000ms)
    clock.advance(1000);
    expect(matches(actor, "connecting")).toBe(true);
  });

  it("full flow: connect → disconnect → reconnect → succeed", () => {
    const { actor, clock } = createWsActor();

    actor.send(connect.create({ url: "ws://example.com" }));
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(disconnect.create());
    expect(matches(actor, "disconnected")).toBe(true);

    actor.send(connect.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);

    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("retry cycle: failure → backoff → connecting → success", () => {
    const { actor, clock } = createWsActor();

    // Attempt and fail
    actor.send(connect.create({ url: "ws://example.com" }));
    actor.__pushInternal(connectionFailed.create({ error: "Timeout" }));
    actor.__drainInternal();
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(1);

    // Backoff: 1000 * 2^1 = 2000ms
    clock.advance(2000);
    expect(matches(actor, "connecting")).toBe(true);

    // This time it succeeds
    clock.advance(500);
    expect(matches(actor, "connected")).toBe(true);
    expect(actor.context.retryCount).toBe(1); // not reset because we didn't reconnect from reconnecting
  });
});
