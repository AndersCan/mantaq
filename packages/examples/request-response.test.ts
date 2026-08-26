/**
 * CANONICAL DOCS EXAMPLE — request / response.
 *
 * Source of truth for the request/response example in the Mantaq docs
 * (apps/docs/src/content/docs/sugar/request-response.mdx). The docs must
 * use ONLY the entity IDs declared here and registered in the registry
 * (.opencode/skills/docs-write/resources/example.mdx).
 *
 * Story: checkout story continues. After checkout the shop asks a shipping
 * partner to confirm each order. One parent machine owns an ActorMap of
 * short-lived request handlers — one per order, keyed by orderId, each with
 * its own timeout, each settling exactly once (answered or timed out).
 * Handlers report back through declared outputs, one wiring line in the
 * factory forwards them into the parent.
 *
 *   request → handler (idle → pending → answered | timedOut) → requestSettled
 *                                                                  ↓
 *             parent (open): record result, emit orderSettled → waitFor resolves
 *
 * The tests are the spec: each one names the desired behavior of the
 * request/response journey, driven by a VirtualClock.
 */

import { Actor, VirtualClock, RealClock, state, event } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { createActorMap, states, events, withTimeout, onOutput } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

type Settled = {
  orderId: string;
  status: "answered" | "timedOut";
  result?: string;
};

type ManagerContext = {
  results: Record<string, Settled>;
};

const request = event("request")<{ orderId: string; timeoutMs: number }>();
const answer = event("answer")<{ orderId: string; result: string }>();
const { timeout } = events("timeout");
const requestSettled = event("requestSettled")<Settled>();
const orderSettled = event("orderSettled")<Settled>();

const { open } = states("open");
const { idle, pending } = states("idle", "pending");
const answered = state("answered")().final();
const timedOut = state("timedOut")().final();

function createRequestHandler(orderId: string, options: { clock: Clock }) {
  const { clock } = options;
  return Actor({
    inputs: [request, answer],
    internal: [timeout],
    outputs: [requestSettled],
    states: [idle, pending, answered, timedOut],
    initial: idle,
    clock,
    context: { orderId, timeoutMs: 0 },
    setup: (m) => {
      m.on(idle, {
        eventRef: request,
        handler: (event, { context }) => {
          const snapshot = context.get();
          snapshot.timeoutMs = event.payload.timeoutMs;
          context.set(snapshot);
          return { state: pending };
        },
      });
      m.effect(pending, {
        name: "startResponseTimeout",
        fn: (input) => {
          withTimeout(input.context.get().timeoutMs, {
            input: input,
            event: () => timeout.create(),
          });
        },
      });
      m.on(pending, {
        eventRef: answer,
        handler: (event) => ({
          state: answered,
          emit: [
            requestSettled.create({ orderId, status: "answered", result: event.payload.result }),
          ],
        }),
      });
      m.on(pending, {
        eventRef: timeout,
        handler: () => ({
          state: timedOut,
          emit: [requestSettled.create({ orderId, status: "timedOut" })],
        }),
      });
    },
  });
}

export function createRequester(options: { clock?: Clock; defaultTimeoutMs?: number } = {}) {
  const clock = options.clock ?? RealClock();
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
  const pending = new Map<string, Array<(settled: Settled) => void>>();

  const initialManagerContext: ManagerContext = { results: {} };

  const manager = Actor({
    inputs: [request, answer, requestSettled],
    outputs: [orderSettled],
    states: [open],
    initial: open,
    clock,
    context: initialManagerContext,
    setup: (m) => {
      m.on(open, {
        eventRef: request,
        handler: (event, { context }) => {
          const snapshot = context.get();
          if (snapshot.results[event.payload.orderId]) {
            delete snapshot.results[event.payload.orderId];
            context.set(snapshot);
          }
          requests.spawn(event.payload.orderId);
          requests.send(event.payload.orderId, request.create(event.payload));
          return {};
        },
      });
      m.on(open, {
        eventRef: answer,
        handler: (event) => {
          requests.send(event.payload.orderId, answer.create(event.payload));
          return {};
        },
      });
      m.on(open, {
        eventRef: requestSettled,
        handler: (event, { context }) => {
          const snapshot = context.get();
          snapshot.results[event.payload.orderId] = event.payload;
          context.set(snapshot);
          return { emit: [orderSettled.create(event.payload)] };
        },
      });
    },
  });

  const requests = createActorMap(
    (orderId) => {
      const child = createRequestHandler(orderId, { clock });
      onOutput(child, (e) => {
        if (requestSettled.is(e)) manager.send(e);
      });
      return child;
    },
    { autoReap: true },
  );

  onOutput(manager, (e) => {
    if (!orderSettled.is(e)) return;
    const resolvers = pending.get(e.payload.orderId);
    if (!resolvers) return;
    pending.delete(e.payload.orderId);
    for (const resolve of resolvers) resolve(e.payload);
  });

  return {
    manager,
    requests,
    request: (options: { orderId: string; timeoutMs?: number }) => {
      manager.send(
        request.create({
          orderId: options.orderId,
          timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
        }),
      );
    },
    answer: (options: { orderId: string; result: string }) => {
      manager.send(answer.create({ orderId: options.orderId, result: options.result }));
    },
    waitFor: (orderId: string): Promise<Settled> => {
      const settled = manager.snapshot().context.results[orderId];
      if (settled) return Promise.resolve(settled);
      return new Promise((resolve) => {
        const list = pending.get(orderId);
        if (list) list.push(resolve);
        else pending.set(orderId, [resolve]);
      });
    },
  };
}

describe("request / response", () => {
  it("creates a fresh handler per request with its own timeout", () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    requester.request({ orderId: "ord_1", timeoutMs: 1000 });

    expect({
      size: requester.requests.size,
      path: requester.requests.snapshot("ord_1")?.path,
      pendingTimer: clock.hasPending(),
    }).toEqual({ size: 1, path: ["pending"], pendingTimer: true });
  });

  it("resolves the waiter and reaps the handler when an answer arrives", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    requester.request({ orderId: "ord_1", timeoutMs: 1000 });
    requester.answer({ orderId: "ord_1", result: "shipped" });

    await expect(requester.waitFor("ord_1")).resolves.toEqual({
      orderId: "ord_1",
      status: "answered",
      result: "shipped",
    });
    expect(requester.requests.size).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it("resolves as timedOut when no answer arrives", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    const promise = requester.waitFor("ord_2");
    requester.request({ orderId: "ord_2", timeoutMs: 1000 });
    clock.advance(1001);

    await expect(promise).resolves.toEqual({ orderId: "ord_2", status: "timedOut" });
    expect(requester.requests.size).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it("ignores a late answer and settles exactly once", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    const promise = requester.waitFor("ord_3");
    requester.request({ orderId: "ord_3", timeoutMs: 1000 });
    clock.advance(1001);

    requester.answer({ orderId: "ord_3", result: "shipped" });

    await expect(promise).resolves.toEqual({ orderId: "ord_3", status: "timedOut" });
    expect(requester.manager.snapshot().context.results["ord_3"]).toEqual({
      orderId: "ord_3",
      status: "timedOut",
    });
  });

  it("returns the first settlement on a duplicate answer", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    requester.request({ orderId: "ord_4", timeoutMs: 1000 });
    requester.answer({ orderId: "ord_4", result: "shipped" });
    requester.answer({ orderId: "ord_4", result: "shipped-again" });

    await expect(requester.waitFor("ord_4")).resolves.toEqual({
      orderId: "ord_4",
      status: "answered",
      result: "shipped",
    });
  });

  it("ignores an answer for an unknown order", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    requester.answer({ orderId: "ghost", result: "nope" });

    expect({
      results: requester.manager.snapshot().context.results,
      size: requester.requests.size,
      pendingTimer: clock.hasPending(),
    }).toEqual({ results: {}, size: 0, pendingTimer: false });
  });

  it("handles many in-flight requests independently", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    const a = requester.waitFor("a");
    const b = requester.waitFor("b");
    const c = requester.waitFor("c");
    requester.request({ orderId: "a", timeoutMs: 1000 });
    requester.request({ orderId: "b", timeoutMs: 2000 });
    requester.request({ orderId: "c", timeoutMs: 3000 });
    expect({ size: requester.requests.size }).toEqual({ size: 3 });

    requester.answer({ orderId: "b", result: "ok" });
    clock.advance(1500);

    await expect(a).resolves.toEqual({ orderId: "a", status: "timedOut" });
    await expect(b).resolves.toEqual({ orderId: "b", status: "answered", result: "ok" });
    expect({ size: requester.requests.size }).toEqual({ size: 1 });

    requester.answer({ orderId: "c", result: "ok" });
    await expect(c).resolves.toEqual({ orderId: "c", status: "answered", result: "ok" });
    expect({ size: requester.requests.size, pendingTimer: clock.hasPending() }).toEqual({
      size: 0,
      pendingTimer: false,
    });
  });

  it("returns the same settled result when waitFor runs twice", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    requester.request({ orderId: "ord_5", timeoutMs: 1000 });
    requester.answer({ orderId: "ord_5", result: "ok" });

    const first = await requester.waitFor("ord_5");
    const second = await requester.waitFor("ord_5");

    expect(first).toEqual({ orderId: "ord_5", status: "answered", result: "ok" });
    expect(second).toEqual(first);
  });

  it("creates a replacement handler and timer when an order is re-dispatched", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    const promise = requester.waitFor("ord_6");
    requester.request({ orderId: "ord_6", timeoutMs: 1000 });
    requester.request({ orderId: "ord_6", timeoutMs: 2000 });

    expect(requester.requests.size).toBe(1);
    clock.advance(1500);
    expect(clock.hasPending()).toBe(true);

    clock.advance(501);
    await expect(promise).resolves.toEqual({ orderId: "ord_6", status: "timedOut" });
    expect(clock.hasPending()).toBe(false);
  });

  it("updates the settlement when an order is re-dispatched after answering", async () => {
    const clock = VirtualClock();
    const requester = createRequester({ clock, defaultTimeoutMs: 1000 });

    requester.request({ orderId: "ord_7", timeoutMs: 1000 });
    requester.answer({ orderId: "ord_7", result: "first" });
    await expect(requester.waitFor("ord_7")).resolves.toEqual({
      orderId: "ord_7",
      status: "answered",
      result: "first",
    });

    requester.request({ orderId: "ord_7", timeoutMs: 1000 }); // re-dispatch clears the settled result
    const second = requester.waitFor("ord_7");
    requester.answer({ orderId: "ord_7", result: "second" });

    await expect(second).resolves.toEqual({
      orderId: "ord_7",
      status: "answered",
      result: "second",
    });
    expect(clock.hasPending()).toBe(false);
  });
});
