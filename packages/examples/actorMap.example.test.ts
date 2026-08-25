import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event, VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { ActorMap, onOutput } from "@mantaq/sugar";

const requestWork = event("REQUEST_WORK")<{ id: string }>();
const doWork = event("DO_WORK")<{ id: string }>();
const workResult = event("WORK_RESULT")<{ id: string; ok: boolean }>();
const allResults = event("ALL_RESULTS")<{ results: Array<{ id: string; ok: boolean }> }>();

const idle = state("idle")();
const working = state("working")();
const collecting = state("collecting")();

function createWorker(id: string, clock: VirtualClock, reportTo: AnyActor) {
  return new Actor({
    inputs: [doWork],
    states: [idle, working],
    initial: idle,
    context: { id, reportTo },
    clock,
    setup: (m) => {
      m.on(idle, doWork, () => ({ state: working }));
      m.effect(working, {
        name: "doWork",
        fn: ({ context, clock }) => {
          clock.setTimeout(10, () => {
            context.get().reportTo.send(workResult.create({ id: context.get().id, ok: true }));
          });
        },
      });
    },
  });
}

describe("actor map example", () => {
  test("dumb keyed registry of one actor type", () => {
    const clock = new VirtualClock();
    const parent = new Actor({
      clock,
      inputs: [requestWork, workResult],
      outputs: [allResults],
      states: [collecting],
      initial: collecting,
      context: { pending: 0, results: [] as Array<{ id: string; ok: boolean }> },
      setup: (m) => {
        m.on(collecting, requestWork, (event, { context }) => {
          const s = context.get();
          s.pending += 1;
          context.set(s);
          workers.spawn(event.payload.id);
          workers.send(event.payload.id, doWork.create({ id: event.payload.id }));
          return {};
        });
        m.on(collecting, workResult, (event, { context }) => {
          const s = context.get();
          s.results = [...s.results, event.payload];
          s.pending -= 1;
          context.set(s);
          return s.pending === 0 ? { emit: [allResults.create({ results: s.results })] } : {};
        });
      },
    });

    // The map is dumb: one actor type, keyed by id. The child knows its
    // reportTo from context — the map does no wiring.
    const workers = new ActorMap((id) => createWorker(id, clock, parent));

    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(parent, (e) => received.push(e));

    parent.send(requestWork.create({ id: "a" }));
    parent.send(requestWork.create({ id: "b" }));
    expect(workers.size).toBe(2);
    expect(workers.keys().sort()).toEqual(["a", "b"]);

    clock.advance(10);
    expect(workers.snapshot("a")?.path).toEqual(["working"]);
    expect(received).toEqual([
      {
        type: "ALL_RESULTS",
        payload: {
          results: [
            { id: "a", ok: true },
            { id: "b", ok: true },
          ],
        },
      },
    ]);
  });
});
