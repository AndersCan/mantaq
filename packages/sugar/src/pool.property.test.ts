import { createPool } from "./index.ts";
import { fc } from "@mantaq/pbt";
import { describe, test } from "vite-plus/test";

async function settleMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

type Step = { kind: "arrive" } | { kind: "finish"; pick: number; ok: boolean };

const anyStep: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ kind: "arrive" }),
  fc.record({
    kind: fc.constant("finish" as const),
    pick: fc.nat(1000),
    ok: fc.boolean(),
  }),
);

/** The simplest pool there is: a list of waiting items and a list of runs. */
function reference(workers: number, batch: number) {
  const waiting: number[] = [];
  const running: number[][] = [];
  const starts: number[][] = [];
  function fill(): void {
    while (waiting.length > 0 && running.length < workers) {
      const items = waiting.splice(0, batch);
      running.push(items);
      starts.push(items);
    }
  }
  return {
    waiting,
    running,
    starts,
    arrive(item: number) {
      waiting.push(item);
      fill();
    },
    finish(pick: number, ok: boolean) {
      const [items] = running.splice(pick % running.length, 1);
      if (!ok) waiting.unshift(...(items as number[]));
      fill();
    },
  };
}

describe("createPool property tests", () => {
  test("matches a queue model: nothing lost or doubled, at most n working, failed items lead", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(anyStep, { maxLength: 30 }),
        async (workers, batch, steps) => {
          const live: Array<{ items: number[]; resolve: () => void; reject: () => void }> = [];
          const starts: number[][] = [];
          const pool = createPool<number, "p">({
            name: "p",
            workers,
            batch,
            run: (items) => {
              starts.push([...items]);
              return new Promise<void>((resolve, reject) => {
                live.push({
                  items: [...items],
                  resolve,
                  reject: () => reject(new Error("fail")),
                });
              });
            },
          });
          const model = reference(workers, batch);
          let next = 0;
          for (const step of steps) {
            if (step.kind === "arrive") {
              pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: next }));
              model.arrive(next);
              next += 1;
            } else if (model.running.length > 0) {
              const index = step.pick % model.running.length;
              const [done] = live.splice(index, 1);
              if (step.ok) done?.resolve();
              else done?.reject();
              model.finish(step.pick, step.ok);
            }
            await settleMicrotasks();
            if (live.length > workers) return false;
            if (JSON.stringify(starts) !== JSON.stringify(model.starts)) return false;
          }
          const state = pool.actor.state.name;
          const expected =
            model.waiting.length > 0
              ? "workWaiting"
              : model.running.length > 0
                ? "workersBusy"
                : "allWorkersFree";
          return state === expected;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("with keep set no item waits twice", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 25 }),
        async (items) => {
          const batches: number[][] = [];
          const live: Array<() => void> = [];
          const pool = createPool<number, "p">({
            name: "p",
            workers: 1,
            keep: "set",
            batch: Infinity,
            run: (taken) => {
              batches.push([...taken]);
              return new Promise<void>((resolve) => live.push(resolve));
            },
          });
          for (const item of items) pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
          await settleMicrotasks();
          live.shift()?.();
          await settleMicrotasks();
          const second = batches[1] ?? [];
          return new Set(second).size === second.length;
        },
      ),
      { numRuns: 100 },
    );
  });
});
