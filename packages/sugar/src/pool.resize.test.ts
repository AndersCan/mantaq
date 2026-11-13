import { createPool } from "./index.ts";
import { fc } from "@mantaq/pbt";
import { describe, expect, test } from "vite-plus/test";

async function turns(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

/** A pool whose runs finish when the test says so. */
function controlled(workers: number) {
  const live: Array<{ items: string[]; resolve: () => void; reject: () => void }> = [];
  const starts: string[][] = [];
  const pool = createPool<string, "p">({
    name: "p",
    workers,
    run: (items) =>
      new Promise<void>((resolve, reject) => {
        starts.push([...items]);
        live.push({ items: [...items], resolve, reject: () => reject(new Error("no")) });
      }),
  });
  const send = (item: string) => pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
  return { pool, live, starts, send };
}

const keys = (pool: { workers: { keys(): string[] } }) => [...pool.workers.keys()].sort();

describe("resize", () => {
  test("growing adds free workers and the first takes the waiting item", async () => {
    const { pool, live, send } = controlled(3);
    for (const item of ["a", "b", "c", "d"]) send(item);
    await turns();
    expect(pool.actor.state.name).toBe("workWaiting");
    pool.resize(5);
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
    expect(live.map((run) => run.items)).toEqual([["a"], ["b"], ["c"], ["d"]]);
    expect(pool.actor.state.name).toBe("workersBusy");
  });

  test("shrinking removes a free worker at once and keeps a running one until it reports", async () => {
    const { pool, live, send } = controlled(3);
    send("a");
    send("b");
    send("c");
    await turns();
    live[0]?.resolve();
    await turns();
    pool.resize(1);
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2", "w3"]);
    live[1]?.resolve();
    await turns();
    expect(keys(pool)).toEqual(["w1", "w3"]);
    live[2]?.resolve();
    await turns();
    expect(keys(pool)).toEqual(["w1"]);
    expect(pool.actor.state.name).toBe("allWorkersFree");
  });

  test("a leaving worker's failed items go to the front and the worker is gone", async () => {
    const { pool, live, starts, send } = controlled(2);
    send("a");
    send("b");
    send("c");
    await turns();
    pool.resize(1);
    live[1]?.reject();
    await turns();
    expect(keys(pool)).toEqual(["w1"]);
    live[0]?.resolve();
    await turns();
    expect(starts.at(-1)).toEqual(["b"]);
    expect(pool.actor.state.name).toBe("workWaiting");
  });

  test("growing back while a leaving worker still runs keeps it and frees it on report", async () => {
    const { pool, live, send } = controlled(3);
    send("a");
    send("b");
    send("c");
    await turns();
    pool.resize(1);
    pool.resize(3);
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2", "w3"]);
    live[2]?.resolve();
    send("d");
    await turns();
    expect(live.at(-1)?.items).toEqual(["d"]);
  });

  test("a gone worker respawns free when the size grows back", async () => {
    const { pool } = controlled(3);
    pool.resize(1);
    await turns();
    expect(keys(pool)).toEqual(["w1"]);
    pool.resize(3);
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2", "w3"]);
    expect(pool.workers.get("w2")?.snapshot().path).toEqual(["free"]);
  });

  test("shrinking and growing back in one turn keeps the free workers", async () => {
    const { pool } = controlled(3);
    pool.resize(1);
    pool.resize(3);
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2", "w3"]);
  });

  test("the inbox lists workers in numeric order past w9", async () => {
    const { pool } = controlled(2);
    pool.resize(11);
    await turns();
    expect(pool.actor.snapshot().context.workers).toEqual(
      Array.from({ length: 11 }, (_, index) => `w${index + 1}`),
    );
  });

  test("resize to the current size moves nothing", async () => {
    const { pool, live, send } = controlled(2);
    send("a");
    await turns();
    pool.resize(2);
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2"]);
    expect(live).toHaveLength(1);
    expect(pool.actor.state.name).toBe("workersBusy");
  });

  test.each([
    [0, 1],
    [-3, 1],
    [2.7, 2],
    [Number.NaN, 1],
  ])("count %s keeps %s workers", async (count, kept) => {
    const { pool } = controlled(4);
    pool.resize(count);
    await turns();
    expect(pool.workers.keys()).toHaveLength(kept);
  });

  test("the diagram's WORKERS_RESIZED event does the same as resize", async () => {
    const { pool } = controlled(3);
    pool.actor.send(pool.events.WORKERS_RESIZED.create({ count: 2 }));
    await turns();
    expect(keys(pool)).toEqual(["w1", "w2"]);
  });

  test("a worker killed by its own report does not throw", async () => {
    const { pool, live, send } = controlled(2);
    send("a");
    send("b");
    await turns();
    pool.resize(1);
    live[1]?.resolve();
    await expect(turns()).resolves.toBeUndefined();
    expect(keys(pool)).toEqual(["w1"]);
  });
});

type Step =
  | { kind: "arrive" }
  | { kind: "finish"; pick: number; ok: boolean }
  | { kind: "resize"; count: number };

const anyStep: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ kind: "arrive" }),
  fc.record({ kind: fc.constant("finish" as const), pick: fc.nat(1000), ok: fc.boolean() }),
  fc.record({ kind: fc.constant("resize" as const), count: fc.integer({ min: 1, max: 5 }) }),
);

describe("resize property", () => {
  test("keeps the map and the inbox in step, never loses or doubles an item", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(anyStep, { maxLength: 30 }),
        async (workers, steps) => {
          const { pool, live, starts, send } = controlled(workers);
          let sent = 0;
          let size = workers;
          const finished: string[] = [];
          for (const step of steps) {
            if (step.kind === "arrive") send(`i${sent++}`);
            else if (step.kind === "resize") {
              pool.resize(step.count);
              size = step.count;
            } else if (live.length > 0) {
              const [run] = live.splice(step.pick % live.length, 1);
              if (step.ok) {
                finished.push(...(run?.items ?? []));
                run?.resolve();
              } else run?.reject();
            }
            await turns();
            const listed = pool.actor.snapshot().context.workers;
            expect(keys(pool)).toEqual([...listed].sort());
            expect(live.length).toBeLessThanOrEqual(Math.max(size, listed.length));
          }
          for (const run of live.splice(0)) {
            finished.push(...run.items);
            run.resolve();
          }
          for (let round = 0; round < sent; round++) {
            await turns();
            for (const run of live.splice(0)) {
              finished.push(...run.items);
              run.resolve();
            }
          }
          await turns();
          expect([...finished].sort()).toEqual(
            Array.from({ length: sent }, (_, index) => `i${index}`).sort(),
          );
          expect(starts.flat().length).toBeGreaterThanOrEqual(sent);
          expect(keys(pool)).toHaveLength(size);
        },
      ),
      { seed: 20261113, numRuns: 100 },
    );
  });
});
