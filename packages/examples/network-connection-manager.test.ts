/**
 * Problem: Network connection management with reconnection logic, health
 * checks, and connection state that UI must reflect. Classic boolean-soup
 * territory: isConnected, isReconnecting, retryCount, lastError, etc.
 *
 * Actor model approach:
 *   - ConnectionManager: manages connection lifecycle
 *   - Regions: connectionState (disconnected/connecting/connected) and
 *     healthMonitor (healthy/degraded/unknown) run concurrently
 *   - Reconnection: exponential backoff via VirtualClock
 *   - Guard conditions: only connect if disconnected, only reconnect if degraded
 *
 * DX Pain Points Exposed:
 *   - Guard conditions require manual state checks (no declarative guards)
 *   - Context mutation in transitions (no immutable update pattern)
 *   - Region communication requires knowing region actor instance
 *   - No snapshot-based guard helpers (must call matches() or check state.name)
 *   - Typing of context across multiple regions requires type assertions
 */

import { Actor, VirtualClock, event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

function inject(actor: AnyActor, event: { type: string }): void {
  actor.inject(event);
}

// ── Connection States ────────────────────────────────────────────────

const networkStates = states(
  "disconnected",
  "connecting",
  "connected",
  "reconnecting",
  "failed",
  "unknown",
  "healthy",
  "degraded",
);
const connectionStates = {
  disconnected: networkStates.disconnected,
  connecting: networkStates.connecting,
  connected: networkStates.connected,
  reconnecting: networkStates.reconnecting,
  failed: networkStates.failed.final(),
};
const healthStates = {
  unknown: networkStates.unknown,
  healthy: networkStates.healthy,
  degraded: networkStates.degraded,
};

// ── Events ───────────────────────────────────────────────────────────

const connectEvent = event("CONNECT")<{ url: string }>();
const connectionFailed = event("CONNECTION_FAILED")<{ error: string }>();
const healthCheckResult = event("HEALTH_CHECK_RESULT")<{ healthy: boolean }>();
const managerEvents = events("DISCONNECT", "CONNECTION_ESTABLISHED", "RETRY", "TIMEOUT");

// ── Context ──────────────────────────────────────────────────────────

type ConnectionContext = {
  url?: string;
  retryCount: number;
  maxRetries: number;
  backoffMs: number;
  lastError?: string;
  healthScore: number;
};

// ── Actor Factory ────────────────────────────────────────────────────

function createConnectionManager(clock?: VirtualClock) {
  const c = clock ?? VirtualClock();

  // Health monitor region
  const healthMonitor = Actor({
    inputs: [healthCheckResult],
    outputs: [],
    internal: [],
    states: [healthStates.unknown, healthStates.healthy, healthStates.degraded],
    initial: healthStates.unknown,
    context: {},
    setup: (m) => {
      m.on(healthStates.unknown, {
        eventRef: healthCheckResult,
        handler: (event) => ({
          state: event.payload.healthy ? healthStates.healthy : healthStates.degraded,
        }),
      });
      m.on(healthStates.healthy, {
        eventRef: healthCheckResult,
        handler: (event) => ({
          state: event.payload.healthy ? healthStates.healthy : healthStates.degraded,
        }),
      });
      m.on(healthStates.degraded, {
        eventRef: healthCheckResult,
        handler: (event) => ({
          state: event.payload.healthy ? healthStates.healthy : healthStates.degraded,
        }),
      });
    },
  });

  const initialContext: ConnectionContext = {
    retryCount: 0,
    maxRetries: 3,
    backoffMs: 1000,
    healthScore: 100,
  };

  // Main connection manager
  const actor = Actor({
    inputs: [connectEvent, managerEvents.DISCONNECT, managerEvents.RETRY],
    outputs: [],
    internal: [
      managerEvents.CONNECTION_ESTABLISHED,
      connectionFailed,
      healthCheckResult,
      managerEvents.TIMEOUT,
    ],
    states: [
      connectionStates.disconnected,
      connectionStates.connecting,
      connectionStates.connected,
      connectionStates.reconnecting,
      connectionStates.failed,
    ],
    initial: connectionStates.disconnected,
    clock: c,
    context: initialContext,
    regions: {
      health: healthMonitor,
    },
    setup: (m) => {
      m.effect(connectionStates.connecting, {
        name: "startConnectionTimeout",
        fn: ({ signal, clock, emit }) => {
          const timeoutId = clock.setTimeout(2000, {
            cb: () => {
              emit(managerEvents.CONNECTION_ESTABLISHED.create());
            },
          });
          signal.addEventListener("abort", () => clock.clearTimeout(timeoutId));
        },
      });
      m.effect(connectionStates.reconnecting, {
        name: "scheduleReconnect",
        fn: ({ signal, clock, emit, context }) => {
          const snapshot = context.get();
          const delay = snapshot.backoffMs * Math.pow(2, snapshot.retryCount);
          const timeoutId = clock.setTimeout(delay, {
            cb: () => {
              emit(managerEvents.CONNECTION_ESTABLISHED.create());
            },
          });
          signal.addEventListener("abort", () => clock.clearTimeout(timeoutId));
        },
      });
      m.on(connectionStates.disconnected, {
        eventRef: connectEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.url = event.payload.url;
          current.retryCount = 0;
          current.lastError = undefined;
          context.set(current);
          return { state: connectionStates.connecting };
        },
      });
      m.on(connectionStates.connecting, {
        eventRef: managerEvents.CONNECTION_ESTABLISHED,
        handler: (_event, { context }) => {
          const current = context.get();
          current.retryCount = 0;
          context.set(current);
          return { state: connectionStates.connected };
        },
      });
      m.on(connectionStates.connecting, {
        eventRef: connectionFailed,
        handler: (event, { context }) => {
          const current = context.get();
          current.lastError = event.payload.error;
          current.retryCount += 1;
          context.set(current);
          if (current.retryCount >= current.maxRetries) {
            return { state: connectionStates.failed };
          }
          return { state: connectionStates.reconnecting };
        },
      });
      m.on(connectionStates.connected, {
        eventRef: managerEvents.DISCONNECT,
        handler: () => ({
          state: connectionStates.disconnected,
        }),
      });
      m.on(connectionStates.connected, {
        eventRef: healthCheckResult,
        handler: (event, { context }) => {
          actor.regions.health.send(healthCheckResult.create({ healthy: event.payload.healthy }));
          if (!event.payload.healthy) {
            const current = context.get();
            current.lastError = "Health check failed";
            current.retryCount = 0;
            context.set(current);
            return { state: connectionStates.reconnecting };
          }
          return {};
        },
      });
      m.on(connectionStates.reconnecting, {
        eventRef: managerEvents.CONNECTION_ESTABLISHED,
        handler: (_event, { context }) => {
          const current = context.get();
          current.retryCount = 0;
          context.set(current);
          return { state: connectionStates.connected };
        },
      });
      m.on(connectionStates.reconnecting, {
        eventRef: connectionFailed,
        handler: (event, { context }) => {
          const current = context.get();
          current.lastError = event.payload.error;
          current.retryCount += 1;
          context.set(current);
          if (current.retryCount >= current.maxRetries) {
            return { state: connectionStates.failed };
          }
          return {};
        },
      });
      m.on(connectionStates.reconnecting, { eventRef: managerEvents.RETRY, handler: () => ({}) });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("connection manager actor", () => {
  it("sets disconnected and unknown health initially", () => {
    const { actor } = createConnectionManager();
    expect(matches(actor, "disconnected")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("sets connected after CONNECTION_ESTABLISHED from CONNECT", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    expect({ matches: matches(actor, "connecting"), url: actor.context.url }).toEqual({
      matches: true,
      url: "ws://example.com",
    });

    clock.advance(2000);
    expect({
      matches: matches(actor, "connected"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 0 });
  });

  it("fails into reconnecting with exponential backoff", () => {
    const { actor } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);
    inject(actor, connectionFailed.create({ error: "ECONNREFUSED" }));
    expect({
      matches: matches(actor, "reconnecting"),
      lastError: actor.context.lastError,
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, lastError: "ECONNREFUSED", retryCount: 1 });
  });

  it("fails permanently after retries exceed maxRetries", () => {
    const { actor } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));

    // 3 failures
    inject(actor, connectionFailed.create({ error: "Error 1" }));
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 1 });
    inject(actor, connectionFailed.create({ error: "Error 2" }));
    expect({
      matches: matches(actor, "reconnecting"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 2 });
    inject(actor, connectionFailed.create({ error: "Error 3" }));
    expect({
      matches: matches(actor, "failed"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 3 });
  });

  it("removes accumulated retries when reconnect succeeds", () => {
    const { actor } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    inject(actor, connectionFailed.create({ error: "Error 1" }));
    inject(actor, connectionFailed.create({ error: "Error 2" }));
    expect(actor.context.retryCount).toBe(2);
    inject(actor, managerEvents.CONNECTION_ESTABLISHED.create());
    expect({
      matches: matches(actor, "connected"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 0 });
  });

  it("returns to disconnected when DISCONNECT fires while connected", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(managerEvents.DISCONNECT.create());
    expect(matches(actor, "disconnected")).toBe(true);
  });

  it("handles a failed health check by reconnecting from connected", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    expect(matches(actor, "connected")).toBe(true);
    inject(actor, healthCheckResult.create({ healthy: false }));
    expect({
      matches: matches(actor, "reconnecting"),
      lastError: actor.context.lastError,
    }).toEqual({ matches: true, lastError: "Health check failed" });
  });

  it("keeps connected when a health check succeeds", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    inject(actor, healthCheckResult.create({ healthy: true }));
    expect({
      matches: matches(actor, "connected"),
      regionMatches: matches(actor, "connected.health.healthy"),
    }).toEqual({ matches: true, regionMatches: true });
  });

  it("keeps health region state independent of connection state", () => {
    const { actor, clock } = createConnectionManager();

    expect(matches(actor, "disconnected.health.unknown")).toBe(true);

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    inject(actor, healthCheckResult.create({ healthy: true }));
    expect(matches(actor, "connected.health.healthy")).toBe(true);
    inject(actor, healthCheckResult.create({ healthy: false }));
    expect(matches(actor, "reconnecting.health.degraded")).toBe(true);
  });

  it("updates context only through mutation across transitions", () => {
    const { actor, clock } = createConnectionManager();

    // Every context update happens through read-modify-write
    actor.send(connectEvent.create({ url: "ws://example.com" }));
    expect({ url: actor.context.url }).toEqual({ url: "ws://example.com" });

    clock.advance(2000);
    expect({ retryCount: actor.context.retryCount }).toEqual({ retryCount: 0 });

    /**
     * DX: must update context in every transition handler by hand
     * No immutable update pattern, no type narrowing
     */
  });

  // ── DX Pain Points ────────────────────────────────────────────────
  it("handles guards as manual state checks", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);

    /**
     * Guard: only reconnect if unhealthy
     * Must manually check state in transition handler
     */
    inject(actor, healthCheckResult.create({ healthy: true }));
    expect(matches(actor, "connected")).toBe(true);

    /**
     * Without a manual guard check, each handler would need an early exit,
     * which is verbose and error-prone for complex guards
     */
  });

  it("updates the health region by sending through the actor instance", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);

    /**
     * To send to health region, must know the region key and actor instance
     * No type-safe region addressing
     */
    actor.regions.health.send(healthCheckResult.create({ healthy: true }));

    /**
     * DX: actor.regions is Record<string, AnyActor> — no type safety
     * Must remember string keys, no compile-time check
     */
    expect(matches(actor, "connected.health.healthy")).toBe(true);
  });
});
