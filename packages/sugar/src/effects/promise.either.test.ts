import { Either } from "@mantaq/utils";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { withPromise } from "./promise.ts";

type PortError = { code: string };
type Loaded = { id: string };

type LoadEvent = { type: "loaded"; payload: Loaded } | { type: "failed"; payload: PortError };

function buildActor(load: () => Promise<Either<PortError, Loaded>>) {
  const idle = state("idle")();
  const loading = state("loading")();
  const ready = state("ready")<Loaded>();
  const failure = state("failure")<PortError>();
  const crashed = state("crashed")<{ message: string }>();
  const parked = state("parked")();
  const start = event("start")();
  const stop = event("stop")();
  const loaded = event("loaded")<Loaded>();
  const failed = event("failed")<PortError>();
  const rejected = event("loadRejected")<{ message: string }>();
  const unrelated = event("unrelated")();

  const actor = Actor({
    inputs: [start, stop],
    internal: [loaded, failed, rejected, unrelated],
    states: [idle, loading, ready, failure, crashed, parked],
    initial: idle,
    clock: VirtualClock(),
    setup: (m) => {
      m.on(idle, { event: start, to: [loading], handler: () => ({ state: loading }) });
      m.on(loading, { event: stop, to: [idle], handler: () => ({ state: idle }) });
      m.on(loading, {
        event: loaded,
        to: [ready],
        handler: (e) => ({ state: ready.create(e.payload) }),
      });
      m.on(loading, {
        event: failed,
        to: [failure],
        handler: (e) => ({ state: failure.create(e.payload) }),
      });
      m.on(loading, {
        event: rejected,
        to: [crashed],
        handler: (e) => ({ state: crashed.create(e.payload) }),
      });
      m.effect(loading, {
        name: "load",
        sends: [loaded, failed, rejected],
        fn: (input) =>
          withPromise({
            promise: load(),
            signal: input.signal,
            emit: input.emit,
            events: {
              success: (r) =>
                Either.match(r, {
                  onLeft: (e): LoadEvent => {
                    expectTypeOf(e).toEqualTypeOf<PortError>();
                    return failed.create(e);
                  },
                  onRight: (v): LoadEvent => {
                    expectTypeOf(v).toEqualTypeOf<Loaded>();
                    return loaded.create(v);
                  },
                }),
              error: (err) => rejected.create({ message: String(err) }),
            },
          }),
      });
      m.effect(parked, {
        name: "undeclared",
        sends: [loaded],
        fn: (input) => {
          // @ts-expect-error unrelated is not in sends
          input.emit(unrelated.create());
        },
      });
    },
  });
  return { actor, start, stop };
}

describe("withPromise with Either results", () => {
  test("a right result lands in the ready state with the typed payload", async () => {
    const { actor, start } = buildActor(() => Promise.resolve(Either.right({ id: "a1" })));
    actor.send(start.create());
    await actor.settled();
    expect(actor.state.name).toBe("ready");
    expect(actor.snapshot().payload).toEqual({ id: "a1" });
  });

  test("a left result lands in the failure state with the typed payload", async () => {
    const { actor, start } = buildActor(() => Promise.resolve(Either.left({ code: "E_NOPE" })));
    actor.send(start.create());
    await actor.settled();
    expect(actor.state.name).toBe("failure");
    expect(actor.snapshot().payload).toEqual({ code: "E_NOPE" });
  });

  test("a rejected promise emits the error event", async () => {
    const { actor, start } = buildActor(() => Promise.reject(new Error("boom")));
    actor.send(start.create());
    await actor.settled();
    expect(actor.state.name).toBe("crashed");
    expect(actor.snapshot().payload).toEqual({ message: "Error: boom" });
  });

  test("a result arriving after abort emits nothing", async () => {
    const controller = new AbortController();
    const emitted: LoadEvent[] = [];
    const done = withPromise({
      promise: Promise.resolve(Either.right({ id: "late" })),
      signal: controller.signal,
      emit: (e: LoadEvent) => emitted.push(e),
      events: {
        success: (r) =>
          Either.match(r, {
            onLeft: (e): LoadEvent => ({ type: "failed", payload: e }),
            onRight: (v): LoadEvent => ({ type: "loaded", payload: v }),
          }),
        error: (): LoadEvent => ({ type: "failed", payload: { code: "E_REJECT" } }),
      },
    });
    controller.abort();
    await done;
    expect(emitted).toEqual([]);
  });

  test("a rejection arriving after abort emits nothing", async () => {
    const controller = new AbortController();
    const emitted: LoadEvent[] = [];
    const done = withPromise({
      promise: Promise.reject<Either<PortError, Loaded>>(new Error("boom")),
      signal: controller.signal,
      emit: (e: LoadEvent) => emitted.push(e),
      events: {
        success: (r) =>
          Either.match(r, {
            onLeft: (e): LoadEvent => ({ type: "failed", payload: e }),
            onRight: (v): LoadEvent => ({ type: "loaded", payload: v }),
          }),
        error: (): LoadEvent => ({ type: "failed", payload: { code: "E_REJECT" } }),
      },
    });
    controller.abort();
    await done;
    expect(emitted).toEqual([]);
  });
});
