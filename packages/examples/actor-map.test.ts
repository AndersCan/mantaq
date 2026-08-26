import { Actor, state, event, VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { createActorMap, onOutput } from "@mantaq/sugar";
import { describe, expect, test } from "vite-plus/test";

const requestWork = event("REQUEST_WORK")<{ id: string }>();
const doWork = event("DO_WORK")<{ id: string }>();
const workResult = event("WORK_RESULT")<{ id: string; ok: boolean }>();
const allResults = event("ALL_RESULTS")<{ results: Array<{ id: string; ok: boolean }> }>();

const idle = state("idle")();
const working = state("working")();
const collecting = state("collecting")();

type WorkerResult = { id: string; ok: boolean };

function createWorker(workerId: string, options: { clock: VirtualClock; reportTo: AnyActor }) {
  const { clock, reportTo } = options;
  return Actor({
    inputs: [doWork],
    states: [idle, working],
    initial: idle,
    /**
     * Only plain data lives in context: actors cannot be structured-cloned,
     * so `reportTo` is captured by this closure instead.
     */
    context: { id: workerId },
    clock,
    setup: (m) => {
      m.on(idle, { eventRef: doWork, handler: () => ({ state: working }) });
      m.effect(working, {
        name: "doWork",
        fn: ({ clock: effectClock }) => {
          effectClock.setTimeout(10, {
            cb: () => {
              reportTo.send(workResult.create({ id: workerId, ok: true }));
            },
          });
        },
      });
    },
  });
}

describe("actor map example", () => {
  test("creates one worker per request and emits every result", () => {
    const clock = VirtualClock();
    const collectorContext: { pending: number; results: WorkerResult[] } = {
      pending: 0,
      results: [],
    };
    const parent = Actor({
      clock,
      inputs: [requestWork, workResult],
      outputs: [allResults],
      states: [collecting],
      initial: collecting,
      context: collectorContext,
      setup: (m) => {
        m.on(collecting, {
          eventRef: requestWork,
          handler: (event, { context }) => {
            const snapshot = context.get();
            snapshot.pending += 1;
            context.set(snapshot);
            try {
              workers.spawn(event.payload.id);
            } catch (e) {
              console.log("spawn failed:", e instanceof Error ? e.stack : String(e));
            }
            workers.send(event.payload.id, doWork.create({ id: event.payload.id }));
            return {};
          },
        });
        m.on(collecting, {
          eventRef: workResult,
          handler: (event, { context }) => {
            const snapshot = context.get();
            snapshot.results = [...snapshot.results, event.payload];
            snapshot.pending -= 1;
            context.set(snapshot);
            return snapshot.pending === 0
              ? { emit: [allResults.create({ results: snapshot.results })] }
              : {};
          },
        });
      },
    });

    /**
     * The map is dumb: one actor type, keyed by id. The child knows its
     * reportTo from context — the map does no wiring.
     */
    const workers = createActorMap((workerId) =>
      createWorker(workerId, { clock, reportTo: parent }),
    );

    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(parent, (e) => received.push(e));

    parent.send(requestWork.create({ id: "a" }));
    parent.send(requestWork.create({ id: "b" }));
    expect({ size: workers.size, keys: workers.keys().sort() }).toEqual({
      size: 2,
      keys: ["a", "b"],
    });

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
