/**
 * PINNED FIXTURE — connection-manager.
 *
 * Source: packages/examples/networkConnectionManager.actor.test.ts
 * (`createConnectionManager`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + tests/fingerprints.test.ts) catches
 * upstream refactors that change the graph shape.
 *
 * Story: network connection lifecycle with exponential backoff reconnection
 * and a concurrent `health` region (unknown → healthy ↔ degraded).
 *
 *   disconnected → connecting → connected → reconnecting → failed (final)
 *   (region) health: unknown → healthy ↔ degraded
 *
 * Deterministic: connection establishment and backoff run on the
 * VirtualClock; no Math.random / Date.now.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

const s = {
  disconnected: state("disconnected")(),
  connecting: state("connecting")(),
  connected: state("connected")(),
  reconnecting: state("reconnecting")(),
  unknown: state("unknown")(),
  healthy: state("healthy")(),
  degraded: state("degraded")(),
};
const failed = state("failed")().final();

const connectionStates = {
  disconnected: s.disconnected,
  connecting: s.connecting,
  connected: s.connected,
  reconnecting: s.reconnecting,
  failed,
};
const healthStates = { unknown: s.unknown, healthy: s.healthy, degraded: s.degraded };

export const connect = event("CONNECT")<{ url: string }>();
export const disconnect = event("DISCONNECT")();
export const retry = event("RETRY")();

const connectionEstablished = event("CONNECTION_ESTABLISHED")();
const connectionFailed = event("CONNECTION_FAILED")<{ error: string }>();
export const healthCheckResult = event("HEALTH_CHECK_RESULT")<{ healthy: boolean }>();
const timeout = event("TIMEOUT")();

type ConnectionContext = {
  url?: string;
  retryCount: number;
  maxRetries: number;
  backoffMs: number;
  lastError?: string;
  healthScore: number;
};

export function createConnectionManager(clock?: VirtualClock) {
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
        state: event.payload.healthy ? healthStates.healthy : healthStates.degraded,
      }));
      m.on(healthStates.healthy, healthCheckResult, (event) => ({
        state: event.payload.healthy ? healthStates.healthy : healthStates.degraded,
      }));
      m.on(healthStates.degraded, healthCheckResult, (event) => ({
        state: event.payload.healthy ? healthStates.healthy : healthStates.degraded,
      }));
    },
  });

  // Main connection manager
  const actor = new Actor({
    inputs: [connect, disconnect, retry],
    outputs: [],
    internal: [connectionEstablished, connectionFailed, healthCheckResult, timeout],
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
          emit(connectionEstablished.create());
        });
        signal.addEventListener("abort", () => clock.clearTimeout(id));
      });
      m.effect(connectionStates.reconnecting, ({ signal, clock, emit, context }) => {
        const s = context.get();
        const delay = s.backoffMs * Math.pow(2, s.retryCount);
        const id = clock.setTimeout(delay, () => {
          emit(connectionEstablished.create());
        });
        signal.addEventListener("abort", () => clock.clearTimeout(id));
      });
      m.on(connectionStates.disconnected, connect, (event, opts) => {
        const s = opts!.context.get();
        s.url = event.payload.url;
        s.retryCount = 0;
        s.lastError = undefined;
        opts!.context.set(s);
        return { state: connectionStates.connecting };
      });
      m.on(connectionStates.connecting, connectionEstablished, (_event, opts) => {
        const s = opts!.context.get();
        s.retryCount = 0;
        opts!.context.set(s);
        return { state: connectionStates.connected };
      });
      m.on(connectionStates.connecting, connectionFailed, (event, opts) => {
        const s = opts!.context.get();
        s.lastError = event.payload.error;
        s.retryCount += 1;
        opts!.context.set(s);
        if (s.retryCount >= s.maxRetries) {
          return { state: connectionStates.failed };
        }
        return { state: connectionStates.reconnecting };
      });
      m.on(connectionStates.connected, disconnect, () => ({
        state: connectionStates.disconnected,
      }));
      m.on(connectionStates.connected, healthCheckResult, (event, opts) => {
        // Forward via the injected actor, not the closure: graph discovery
        // (buildVizGraph) dry-runs handlers with a sandboxed actor so the
        // live region is never mutated (plan §6.4 non-mutating contract).
        opts!.actor.regions.health.send(
          healthCheckResult.create({ healthy: event.payload.healthy }),
        );
        if (!event.payload.healthy) {
          const s = opts!.context.get();
          s.lastError = "Health check failed";
          s.retryCount = 0;
          opts!.context.set(s);
          return { state: connectionStates.reconnecting };
        }
        return {};
      });
      m.on(connectionStates.reconnecting, connectionEstablished, (_event, opts) => {
        const s = opts!.context.get();
        s.retryCount = 0;
        opts!.context.set(s);
        return { state: connectionStates.connected };
      });
      m.on(connectionStates.reconnecting, connectionFailed, (event, opts) => {
        const s = opts!.context.get();
        s.lastError = event.payload.error;
        s.retryCount += 1;
        opts!.context.set(s);
        if (s.retryCount >= s.maxRetries) {
          return { state: connectionStates.failed };
        }
        return {};
      });
      m.on(connectionStates.reconnecting, retry, () => ({}));
    },
  });

  return { actor, clock: c };
}
