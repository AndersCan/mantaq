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

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, event } from "@mantaq/core";
import { pushInternal, drainInternal } from "@mantaq/core/internal";
import type { RegistryError } from "@mantaq/core/internal";
import { Either } from "@mantaq/utils";
import { matches, states, events } from "@mantaq/sugar";

function inject(actor: object, event: { id: string }): void {
  Either.match(
    pushInternal(actor, event),
    (err: RegistryError) => {
      throw new Error(err.message);
    },
    () => {},
  );
  Either.match(
    drainInternal(actor),
    (err: RegistryError) => {
      throw new Error(err.message);
    },
    () => {},
  );
}

// ── Connection States ────────────────────────────────────────────────

const s = states(
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
  disconnected: s.disconnected,
  connecting: s.connecting,
  connected: s.connected,
  reconnecting: s.reconnecting,
  failed: s.failed.final(),
};
const healthStates = { unknown: s.unknown, healthy: s.healthy, degraded: s.degraded };

// ── Events ───────────────────────────────────────────────────────────

const connectEvent = event("CONNECT")<{ url: string }>();
const connectionFailed = event("CONNECTION_FAILED")<{ error: string }>();
const healthCheckResult = event("HEALTH_CHECK_RESULT")<{ healthy: boolean }>();
const e = events("DISCONNECT", "CONNECTION_ESTABLISHED", "RETRY", "TIMEOUT");

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
  const c = clock ?? new VirtualClock();

  // Health monitor region
  const healthMonitor = new Actor({
    inputs: [healthCheckResult],
    outputs: [],
    internal: [],
    states: [healthStates.unknown, healthStates.healthy, healthStates.degraded],
    initial: healthStates.unknown,
    context: {} as {},
    setup: (m) => {
      m.on(healthStates.unknown, healthCheckResult, (event) => ({
        state: event.healthy ? healthStates.healthy : healthStates.degraded,
      }));
      m.on(healthStates.healthy, healthCheckResult, (event) => ({
        state: event.healthy ? healthStates.healthy : healthStates.degraded,
      }));
      m.on(healthStates.degraded, healthCheckResult, (event) => ({
        state: event.healthy ? healthStates.healthy : healthStates.degraded,
      }));
    },
  });

  // Main connection manager
  const actor = new Actor({
    inputs: [connectEvent, e.DISCONNECT, e.RETRY],
    outputs: [],
    internal: [e.CONNECTION_ESTABLISHED, connectionFailed, healthCheckResult, e.TIMEOUT],
    states: [
      connectionStates.disconnected,
      connectionStates.connecting,
      connectionStates.connected,
      connectionStates.reconnecting,
      connectionStates.failed,
    ],
    initial: connectionStates.disconnected,
    clock: c,
    context: {
      retryCount: 0,
      maxRetries: 3,
      backoffMs: 1000,
      healthScore: 100,
    } as ConnectionContext,
    regions: {
      health: healthMonitor,
    },
    setup: (m) => {
      m.effect(connectionStates.connecting, ({ signal, clock, emit }) => {
        const id = clock.setTimeout(2000, () => {
          emit(e.CONNECTION_ESTABLISHED.create());
        });
        signal.addEventListener("abort", () => clock.clearTimeout(id));
      });
      m.effect(connectionStates.reconnecting, ({ signal, clock, emit, context }) => {
        const ctx = context as ConnectionContext;
        const delay = ctx.backoffMs * Math.pow(2, ctx.retryCount);
        const id = clock.setTimeout(delay, () => {
          emit(e.CONNECTION_ESTABLISHED.create());
        });
        signal.addEventListener("abort", () => clock.clearTimeout(id));
      });
      m.on(connectionStates.disconnected, connectEvent, (event, opts) => {
        const ctx = opts!.context;
        ctx.url = event.url;
        ctx.retryCount = 0;
        ctx.lastError = undefined;
        return { state: connectionStates.connecting };
      });
      m.on(connectionStates.connecting, e.CONNECTION_ESTABLISHED, (_event, opts) => {
        opts!.context.retryCount = 0;
        return { state: connectionStates.connected };
      });
      m.on(connectionStates.connecting, connectionFailed, (event, opts) => {
        const ctx = opts!.context;
        ctx.lastError = event.error;
        ctx.retryCount++;
        if (ctx.retryCount >= ctx.maxRetries) {
          return { state: connectionStates.failed };
        }
        return { state: connectionStates.reconnecting };
      });
      m.on(connectionStates.connected, e.DISCONNECT, () => ({
        state: connectionStates.disconnected,
      }));
      m.on(connectionStates.connected, healthCheckResult, (event, opts) => {
        actor.regions.health.send(healthCheckResult.create({ healthy: event.healthy }));
        const ctx = opts!.context;
        if (!event.healthy) {
          ctx.lastError = "Health check failed";
          ctx.retryCount = 0;
          return { state: connectionStates.reconnecting };
        }
        return {};
      });
      m.on(connectionStates.reconnecting, e.CONNECTION_ESTABLISHED, (_event, opts) => {
        opts!.context.retryCount = 0;
        return { state: connectionStates.connected };
      });
      m.on(connectionStates.reconnecting, connectionFailed, (event, opts) => {
        const ctx = opts!.context;
        ctx.lastError = event.error;
        ctx.retryCount++;
        if (ctx.retryCount >= ctx.maxRetries) {
          return { state: connectionStates.failed };
        }
        return {};
      });
      m.on(connectionStates.reconnecting, e.RETRY, () => ({}));
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("connection manager actor", () => {
  it("starts disconnected with health unknown", () => {
    const { actor } = createConnectionManager();
    expect(matches(actor, "disconnected")).toBe(true);
    expect(matches(actor, "disconnected.health.unknown")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("CONNECT → connecting → connected (success path)", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);
    expect(actor.context.url).toBe("ws://example.com");

    clock.advance(2000);
    expect(matches(actor, "connected")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("CONNECT fails → reconnecting with exponential backoff", () => {
    const { actor } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    expect(matches(actor, "connecting")).toBe(true);
    inject(actor, connectionFailed.create({ error: "ECONNREFUSED" }));
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.lastError).toBe("ECONNREFUSED");
    expect(actor.context.retryCount).toBe(1);
  });

  it("retries up to maxRetries then fails", () => {
    const { actor } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));

    // 3 failures
    inject(actor, connectionFailed.create({ error: "Error 1" }));
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(1);
    inject(actor, connectionFailed.create({ error: "Error 2" }));
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.retryCount).toBe(2);
    inject(actor, connectionFailed.create({ error: "Error 3" }));
    expect(matches(actor, "failed")).toBe(true);
    expect(actor.context.retryCount).toBe(3);
  });

  it("reconnect success resets retry count", () => {
    const { actor } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    inject(actor, connectionFailed.create({ error: "Error 1" }));
    inject(actor, connectionFailed.create({ error: "Error 2" }));
    expect(actor.context.retryCount).toBe(2);
    inject(actor, e.CONNECTION_ESTABLISHED.create());
    expect(matches(actor, "connected")).toBe(true);
    expect(actor.context.retryCount).toBe(0);
  });

  it("connected → DISCONNECT → disconnected", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    expect(matches(actor, "connected")).toBe(true);

    actor.send(e.DISCONNECT.create());
    expect(matches(actor, "disconnected")).toBe(true);
  });

  it("health check failure triggers reconnect from connected", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    expect(matches(actor, "connected")).toBe(true);
    inject(actor, healthCheckResult.create({ healthy: false }));
    expect(matches(actor, "reconnecting")).toBe(true);
    expect(actor.context.lastError).toBe("Health check failed");
  });

  it("health check success keeps connected", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    inject(actor, healthCheckResult.create({ healthy: true }));
    expect(matches(actor, "connected")).toBe(true);
    expect(matches(actor, "connected.health.healthy")).toBe(true);
  });

  it("health region tracks health state independently", () => {
    const { actor, clock } = createConnectionManager();

    expect(matches(actor, "disconnected.health.unknown")).toBe(true);

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);
    inject(actor, healthCheckResult.create({ healthy: true }));
    expect(matches(actor, "connected.health.healthy")).toBe(true);
    inject(actor, healthCheckResult.create({ healthy: false }));
    expect(matches(actor, "reconnecting.health.degraded")).toBe(true);
  });

  it("context mutation is the only way to update across transitions", () => {
    const { actor, clock } = createConnectionManager();

    // Every context update requires type assertion
    actor.send(connectEvent.create({ url: "ws://example.com" }));
    expect((actor.context as ConnectionContext).url).toBe("ws://example.com");

    clock.advance(2000);
    expect((actor.context as ConnectionContext).retryCount).toBe(0);

    // DX: must cast context in every transition handler
    // No immutable update pattern, no type narrowing
  });

  // ── DX Pain Points ────────────────────────────────────────────────
  it("DX: guard conditions are manual state checks", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);

    // Guard: only reconnect if unhealthy
    // Must manually check state in transition handler
    inject(actor, healthCheckResult.create({ healthy: true }));
    expect(matches(actor, "connected")).toBe(true);

    // Without manual check, would need:
    // if (actor.state.name !== "connected") return {};
    // This is verbose and error-prone for complex guards
  });

  it("DX: region communication requires knowing actor instance", () => {
    const { actor, clock } = createConnectionManager();

    actor.send(connectEvent.create({ url: "ws://example.com" }));
    clock.advance(2000);

    // To send to health region, must know the region key and actor instance
    // No type-safe region addressing
    actor.regions.health.send(healthCheckResult.create({ healthy: true }));

    // DX: actor.regions is Record<string, AnyActor> — no type safety
    // Must remember string keys, no compile-time check
    expect(matches(actor, "connected.health.healthy")).toBe(true);
  });
});
