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
 * Handlers report back through declared outputs; one wiring line in the
 * factory forwards them into the parent.
 *
 *   request → handler (idle → pending → answered | timedOut) → requestSettled
 *                                                                  ↓
 *             parent (open): record result, emit orderSettled → waitFor resolves
 *
 * The tests are the spec: each one names the desired behavior of the
 * request/response journey, driven by a VirtualClock.
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, RealClock, state, event } from "@mantaq/core";
import type { Clock, CreatedOfEvent } from "@mantaq/core";
import { ActorMap, states, events, withTimeout, onOutput } from "@mantaq/sugar";

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

function createRequestHandler(orderId: string, clock: Clock) {
  return new Actor({
    inputs: [request, answer],
    internal: [timeout],
    outputs: [requestSettled],
    states: [idle, pending, answered, timedOut],
    initial: idle,
    clock,
    context: { orderId, timeoutMs: 0 },
    setup: (m) => {
      m.on(idle, request, (event, opts) => {
        const s = opts.context.get();
        s.timeoutMs = event.payload.timeoutMs;
        opts.context.set(s);
        return { state: pending };
      });
      m.effect(pending, (input) => {
        withTimeout(input.context.get().timeoutMs, input, () => timeout.create());
      });
      m.on(pending, answer, (event) => ({
        state: answered,
        emit: [
          requestSettled.create({ orderId, status: "answered", result: event.payload.result }),
        ],
      }));
      m.on(pending, timeout, () => ({
        state: timedOut,
        emit: [requestSettled.create({ orderId, status: "timedOut" })],
      }));
    },
  });
}

export function createRequester(clock: Clock = new RealClock(), defaultTimeoutMs = 5000) {
  const pending = new Map<string, Array<(settled: Settled) => void>>();

  const manager = new Actor({
    inputs: [request, answer, requestSettled],
    outputs: [orderSettled],
    states: [open],
    initial: open,
    clock,
    context: { results: {} } as ManagerContext,
    setup: (m) => {
      m.on(open, request, (event, opts) => {
        const s = opts.context.get();
        if (s.results[event.payload.orderId]) {
          delete s.results[event.payload.orderId];
          opts.context.set(s);
        }
        requests.spawn(event.payload.orderId);
        requests.send(event.payload.orderId, request.create(event.payload));
        return {};
      });
      m.on(open, answer, (event) => {
        requests.send(event.payload.orderId, answer.create(event.payload));
        return {};
      });
      m.on(open, requestSettled, (event, opts) => {
        const s = opts.context.get();
        s.results[event.payload.orderId] = event.payload;
        opts.context.set(s);
        return { emit: [orderSettled.create(event.payload)] };
      });
    },
  });

  const requests = new ActorMap(
    (orderId) => {
      const child = createRequestHandler(orderId, clock);
      onOutput(child, (e) => {
        // `is()` narrows the type tag only, so forward via an explicit cast once
        // the tag is confirmed. `requestSettled` is only emitted with a `Settled`
        // payload in this wiring, making the cast sound.
        if (e.type === requestSettled.type) {
          manager.send(e as CreatedOfEvent<"requestSettled", Settled>);
        }
      });
      return child;
    },
    { autoReap: true },
  );

  onOutput(manager, (e) => {
    // `is()` narrows the type tag only; the payload is read from the already
    // correctly-typed output event. `orderSettled` is only ever emitted with a
    // `Settled` payload, so this cast is sound in this wiring.
    if (e.type !== orderSettled.type) return;
    const payload = e.payload as Settled;
    const resolvers = pending.get(payload.orderId);
    if (!resolvers) return;
    pending.delete(payload.orderId);
    for (const resolve of resolvers) resolve(payload);
  });

  return {
    manager,
    requests,
    request: (orderId: string, timeoutMs: number = defaultTimeoutMs) => {
      manager.send(request.create({ orderId, timeoutMs }));
    },
    answer: (orderId: string, result: string) => {
      manager.send(answer.create({ orderId, result }));
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
  it("dispatches a request to a fresh handler with its own timeout", () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    requester.request("ord_1", 1000);

    expect(requester.requests.size).toBe(1);
    expect(requester.requests.snapshot("ord_1")?.path).toEqual(["pending"]);
    expect(clock.hasPending()).toBe(true);
  });

  it("answers a request: reports back, promise resolves, handler is reaped", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    requester.request("ord_1", 1000);
    requester.answer("ord_1", "shipped");

    await expect(requester.waitFor("ord_1")).resolves.toEqual({
      orderId: "ord_1",
      status: "answered",
      result: "shipped",
    });
    expect(requester.requests.size).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it("times out an unanswered request", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    const promise = requester.waitFor("ord_2");
    requester.request("ord_2", 1000);
    clock.advance(1001);

    await expect(promise).resolves.toEqual({ orderId: "ord_2", status: "timedOut" });
    expect(requester.requests.size).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it("drops a late answer — settles exactly once", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    const promise = requester.waitFor("ord_3");
    requester.request("ord_3", 1000);
    clock.advance(1001);

    requester.answer("ord_3", "shipped");

    await expect(promise).resolves.toEqual({ orderId: "ord_3", status: "timedOut" });
    expect(requester.manager.snapshot().context.results["ord_3"]).toEqual({
      orderId: "ord_3",
      status: "timedOut",
    });
  });

  it("settles once on a duplicate answer", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    requester.request("ord_4", 1000);
    requester.answer("ord_4", "shipped");
    requester.answer("ord_4", "shipped-again");

    await expect(requester.waitFor("ord_4")).resolves.toEqual({
      orderId: "ord_4",
      status: "answered",
      result: "shipped",
    });
  });

  it("ignores an answer for an unknown order", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    requester.answer("ghost", "nope");

    expect(requester.manager.snapshot().context.results).toEqual({});
    expect(requester.requests.size).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it("settles many in-flight requests independently", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    const a = requester.waitFor("a");
    const b = requester.waitFor("b");
    const c = requester.waitFor("c");
    requester.request("a", 1000);
    requester.request("b", 2000);
    requester.request("c", 3000);
    expect(requester.requests.size).toBe(3);

    requester.answer("b", "ok");
    clock.advance(1500);

    await expect(a).resolves.toEqual({ orderId: "a", status: "timedOut" });
    await expect(b).resolves.toEqual({ orderId: "b", status: "answered", result: "ok" });
    expect(requester.requests.size).toBe(1);

    requester.answer("c", "ok");
    await expect(c).resolves.toEqual({ orderId: "c", status: "answered", result: "ok" });
    expect(requester.requests.size).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it("waitFor is idempotent after settlement", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    requester.request("ord_5", 1000);
    requester.answer("ord_5", "ok");

    const first = await requester.waitFor("ord_5");
    const second = await requester.waitFor("ord_5");

    expect(first).toEqual({ orderId: "ord_5", status: "answered", result: "ok" });
    expect(second).toEqual(first);
  });

  it("re-dispatching an order replaces the in-flight handler and its timer", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    const promise = requester.waitFor("ord_6");
    requester.request("ord_6", 1000);
    requester.request("ord_6", 2000);

    expect(requester.requests.size).toBe(1);
    clock.advance(1500);
    expect(clock.hasPending()).toBe(true);

    clock.advance(501);
    await expect(promise).resolves.toEqual({ orderId: "ord_6", status: "timedOut" });
    expect(clock.hasPending()).toBe(false);
  });

  it("re-dispatch supersedes a settled result — waitFor waits for the new attempt", async () => {
    const clock = new VirtualClock();
    const requester = createRequester(clock, 1000);

    requester.request("ord_7", 1000);
    requester.answer("ord_7", "first");
    await expect(requester.waitFor("ord_7")).resolves.toEqual({
      orderId: "ord_7",
      status: "answered",
      result: "first",
    });

    requester.request("ord_7", 1000); // re-dispatch clears the settled result
    const second = requester.waitFor("ord_7");
    requester.answer("ord_7", "second");

    await expect(second).resolves.toEqual({
      orderId: "ord_7",
      status: "answered",
      result: "second",
    });
    expect(clock.hasPending()).toBe(false);
  });
});
