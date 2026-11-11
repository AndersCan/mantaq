import { createPool, poolEvents } from "./index.ts";
import { VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

/** A run that fails before its first await: parsing bad JSON throws a SyntaxError. */
function failsSynchronously(): never {
  return JSON.parse("{") as never;
}

interface Declared {
  inputs: Array<{ type: string }>;
  outputs: Array<{ type: string }>;
  targets: Record<string, Record<string, string[]>>;
  effects: Record<string, Array<{ name: string; sends?: string[] }>>;
}

function declaredBy(actor: unknown): Declared {
  return (actor as { options: Declared }).options;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A run the test finishes by hand. */
function controlled() {
  const runs: Array<{
    items: readonly string[];
    resolve: () => void;
    reject: (reason: unknown) => void;
  }> = [];
  const starts: string[][] = [];
  function run(items: readonly string[]): Promise<void> {
    starts.push([...items]);
    return new Promise<void>((resolve, reject) => {
      runs.push({ items, resolve, reject });
    });
  }
  return { run, runs, starts };
}

function workerStates(pool: { workers: { keys(): string[]; snapshot(key: string): unknown } }) {
  return pool.workers
    .keys()
    .map((key) => (pool.workers.snapshot(key) as { path: string[] }).path[0]);
}

describe("createPool", () => {
  test("7 items with 3 workers run at most 3 at once", async () => {
    const control = controlled();
    let peak = 0;
    let finished = 0;
    const pool = createPool<string, "team">({
      name: "team",
      workers: 3,
      run: (items) => {
        const result = control.run(items);
        peak = Math.max(peak, control.runs.length - finished);
        return result;
      },
    });
    for (let n = 1; n <= 7; n++) {
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: `item${n}` }));
    }
    await flush();
    expect(workerStates(pool)).toEqual(["working", "working", "working"]);
    while (finished < 7) {
      const next = control.runs[finished];
      finished += 1;
      next?.resolve();
      await flush();
    }
    expect({ peak, started: control.starts.flat(), end: pool.actor.state.name }).toEqual({
      peak: 3,
      started: ["item1", "item2", "item3", "item4", "item5", "item6", "item7"],
      end: "empty",
    });
  });

  test("the inbox holds what no worker can take, and a free worker pulls it", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "b" }));
    await flush();
    expect(pool.actor.state.name).toBe("holding");
    control.runs[0]?.resolve();
    await flush();
    expect({ starts: control.starts, state: pool.actor.state.name }).toEqual({
      starts: [["a"], ["b"]],
      state: "empty",
    });
  });

  test("failed items go back to the front", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    for (const item of ["a", "b", "c"]) {
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    }
    await flush();
    control.runs[0]?.reject(new Error("boom"));
    await flush();
    expect(control.starts).toEqual([["a"], ["a"]]);
  });

  test("a throw before the first await counts as a failure", async () => {
    const starts: string[][] = [];
    let first = true;
    const pool = createPool<string, "p">({
      name: "p",
      workers: 1,
      run: (items) => {
        starts.push([...items]);
        if (first) {
          first = false;
          failsSynchronously();
        }
        return Promise.resolve();
      },
    });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    await flush();
    expect({ starts, end: pool.actor.state.name }).toEqual({
      starts: [["a"], ["a"]],
      end: "empty",
    });
  });

  test("keep set with batch Infinity: a failed run's items rejoin the items that wait", async () => {
    const control = controlled();
    const pool = createPool<string, "wake">({
      name: "wake",
      workers: 1,
      keep: "set",
      batch: Infinity,
      run: control.run,
    });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "stuck:5" }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "stuck:7" }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "stuck:5" }));
    await flush();
    control.runs[0]?.reject(new Error("fail"));
    await flush();
    control.runs[1]?.resolve();
    await flush();
    expect({ starts: control.starts, end: pool.actor.state.name }).toEqual({
      starts: [["stuck:5"], ["stuck:7", "stuck:5"]],
      end: "empty",
    });
  });

  test("keep set does not add a key that already waits", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({
      name: "p",
      workers: 1,
      keep: "set",
      run: control.run,
    });
    for (const item of ["a", "b", "b", "b"]) {
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    }
    await flush();
    control.runs[0]?.resolve();
    await flush();
    control.runs[1]?.resolve();
    await flush();
    expect(control.starts).toEqual([["a"], ["b"]]);
  });

  test("key decides identity for keep set", async () => {
    const control = controlled();
    const pool = createPool<{ id: number; note: string }, "p">({
      name: "p",
      workers: 1,
      keep: "set",
      key: (item) => String(item.id),
      run: (items) => control.run(items.map((item) => item.note)),
    });
    for (const item of [
      { id: 1, note: "first" },
      { id: 2, note: "x" },
      { id: 2, note: "y" },
    ]) {
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    }
    await flush();
    control.runs[0]?.resolve();
    await flush();
    expect(control.starts).toEqual([["first"], ["x"]]);
  });

  test("batch caps how many items one worker takes", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, batch: 2, run: control.run });
    for (const item of ["a", "b", "c"]) {
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    }
    await flush();
    expect(control.starts).toEqual([["a"]]);
    control.runs[0]?.resolve();
    await flush();
    expect(control.starts).toEqual([["a"], ["b", "c"]]);
  });

  test("workers below 1 or fractional round to whole workers, at least 1", () => {
    const run = () => Promise.resolve();
    const sizes = [0, -3, Number.NaN, 2.9].map(
      (workers) => createPool<string, "p">({ name: "p", workers, run }).workers.size,
    );
    expect(sizes).toEqual([1, 1, 1, 2]);
  });

  test("a busy worker sent more work returns it, and it is assigned next", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 2, run: control.run });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    await flush();
    pool.workers.send("w1", pool.events.ITEMS_ASSIGNED.create({ worker: "w1", items: ["x"] }));
    await flush();
    expect(control.starts).toEqual([["a"], ["x"]]);
  });

  test("returned items go ahead of the items that already wait", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "b" }));
    await flush();
    pool.workers.send("w1", pool.events.ITEMS_ASSIGNED.create({ worker: "w1", items: ["x"] }));
    await flush();
    control.runs[0]?.resolve();
    await flush();
    expect(control.starts.slice(0, 2)).toEqual([["a"], ["x"]]);
  });

  test("ids the pool does not know change nothing", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    const before = pool.actor.snapshot();
    for (const worker of ["w9", "", "__proto__"]) {
      pool.actor.send(pool.events.ITEMS_FINISHED.create({ worker, items: ["z"] }));
      pool.actor.send(pool.events.ITEMS_FAILED.create({ worker, items: ["z"], error: "e" }));
      pool.actor.send(pool.events.ITEMS_RETURNED.create({ worker, items: ["z"] }));
    }
    await flush();
    expect({ snapshot: pool.actor.snapshot(), starts: control.starts }).toEqual({
      snapshot: before,
      starts: [],
    });
  });

  test("a finish for a worker that is not busy does not add it twice", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    pool.actor.send(pool.events.ITEMS_FINISHED.create({ worker: "w1", items: [] }));
    pool.actor.send(pool.events.ITEMS_FAILED.create({ worker: "w1", items: ["z"], error: "e" }));
    for (const item of ["a", "b"]) pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    await flush();
    expect(control.starts).toEqual([["a"]]);
  });

  test("two pools have disjoint event ids", () => {
    const run = () => Promise.resolve();
    const a = createPool<string, "a">({ name: "a", workers: 1, run });
    const b = createPool<string, "b">({ name: "b", workers: 1, run });
    const left = Object.values(a.events).map((ref) => ref.type);
    const right = Object.values(b.events).map((ref) => ref.type);
    expect({ left: left.length, shared: left.filter((id) => right.includes(id)) }).toEqual({
      left: 7,
      shared: [],
    });
    expect(left.every((id) => id.startsWith("a."))).toBe(true);
  });

  test("poolEvents builds the same ids createPool uses", () => {
    const run = () => Promise.resolve();
    const pool = createPool<string, "team">({ name: "team", workers: 1, run });
    expect(Object.values(poolEvents<string, "team">("team")).map((ref) => ref.type)).toEqual(
      Object.values(pool.events).map((ref) => ref.type),
    );
  });

  test("disposing the pool aborts the signal of a running item", async () => {
    let aborted = false;
    const pool = createPool<string, "p">({
      name: "p",
      workers: 1,
      run: (_items, { signal }) =>
        new Promise<void>(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
    });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    await flush();
    pool.workers.dispose();
    expect(aborted).toBe(true);
  });
});

describe("createPool details", () => {
  function listen(child: unknown, into: Array<{ type: string; payload?: unknown }>) {
    (child as AnyActor).on("output", { fn: (out) => into.push(out) });
  }

  test("names its states and starts every worker free with no items", () => {
    const pool = createPool<string, "p">({ name: "p", workers: 2, run: () => Promise.resolve() });
    expect({
      inbox: pool.actor.state.name,
      workers: workerStates(pool),
      items: pool.workers.keys().map((key) => pool.workers.snapshot(key)?.context),
    }).toEqual({
      inbox: "empty",
      workers: ["free", "free"],
      items: [{ items: [] }, { items: [] }],
    });
  });

  test("a worker that is working is called working, and holding names a waiting inbox", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "b" }));
    await flush();
    expect({ inbox: pool.actor.state.name, workers: workerStates(pool) }).toEqual({
      inbox: "holding",
      workers: ["working"],
    });
    control.runs[0]?.resolve();
    await flush();
    expect(pool.workers.snapshot("w1")?.context).toEqual({ items: ["b"] });
    control.runs[1]?.resolve();
    await flush();
    expect(pool.workers.snapshot("w1")?.context).toEqual({ items: [] });
  });

  test("a failed worker clears its items", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 2, run: control.run });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    await flush();
    control.runs[0]?.reject("no");
    await flush();
    expect(pool.workers.snapshot("w1")?.context).toEqual({ items: [] });
  });

  test("the inbox assigns exactly the first waiting items to the first free worker", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 2, batch: 2, run: control.run });
    const assigned: Array<{ type: string; payload?: unknown }> = [];
    listen(pool.actor, assigned);
    for (const item of ["a", "b", "c"]) pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    await flush();
    expect(assigned).toEqual([
      { type: "p.ITEMS_ASSIGNED", payload: { worker: "w1", items: ["a"] } },
      { type: "p.ITEMS_ASSIGNED", payload: { worker: "w2", items: ["b"] } },
    ]);
  });

  test("a worker reports finished, failed (with the reason) and returned to the inbox", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: control.run });
    const heard: Array<{ type: string; payload?: unknown }> = [];
    listen(pool.workers.get("w1"), heard);
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    await flush();
    pool.workers.send("w1", pool.events.ITEMS_ASSIGNED.create({ worker: "w1", items: ["x"] }));
    control.runs[0]?.reject(new Error("boom"));
    await flush();
    control.runs[1]?.resolve();
    await flush();
    expect(heard).toEqual([
      { type: "p.ITEMS_RETURNED", payload: { worker: "w1", items: ["x"] } },
      { type: "p.ITEMS_FAILED", payload: { worker: "w1", items: ["a"], error: "Error: boom" } },
      { type: "p.ITEMS_FINISHED", payload: { worker: "w1", items: ["a"] } },
    ]);
  });

  test("in queue mode equal items all wait, and failed items keep their duplicates", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({
      name: "p",
      workers: 1,
      batch: Infinity,
      run: control.run,
    });
    for (const item of ["a", "b", "b"]) pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    await flush();
    control.runs[0]?.reject(new Error("x"));
    await flush();
    expect(control.starts).toEqual([["a"], ["a", "b", "b", "a"]]);
  });

  test("set mode puts failed items that no longer wait ahead of those that do", async () => {
    const control = controlled();
    const pool = createPool<string, "p">({
      name: "p",
      workers: 1,
      keep: "set",
      batch: Infinity,
      run: control.run,
    });
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
    pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "b" }));
    await flush();
    control.runs[0]?.reject(new Error("x"));
    await flush();
    expect(control.starts).toEqual([["a"], ["a", "b"]]);
  });

  test("the clock reaches the inbox and every worker", () => {
    const clock = VirtualClock();
    const pool = createPool<string, "p">({
      name: "p",
      workers: 2,
      clock,
      run: () => Promise.resolve(),
    });
    const clocks = pool.workers.keys().map((key) => (pool.workers.get(key) as AnyActor).clock);
    expect([pool.actor.clock, ...clocks]).toEqual([clock, clock, clock]);
  });

  test("declares its inputs, outputs, targets and effect for tooling", () => {
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: () => Promise.resolve() });
    const options = declaredBy(pool.actor);
    const workerOptions = declaredBy(pool.workers.get("w1"));
    expect({
      inputs: options.inputs.map((ref) => ref.type),
      outputs: options.outputs.map((ref) => ref.type),
      targets: ["p.ITEM_ARRIVED", "p.ITEMS_FINISHED", "p.ITEMS_FAILED", "p.ITEMS_RETURNED"].map(
        (id) => options.targets.Any?.[id],
      ),
      workerInputs: workerOptions.inputs.map((ref) => ref.type),
      workerOutputs: workerOptions.outputs.map((ref) => ref.type),
      workerTargets: [
        workerOptions.targets.working?.["p.RUN_SUCCEEDED"],
        workerOptions.targets.working?.["p.RUN_FAILED"],
      ],
      assignTargets: workerOptions.targets.free?.["p.ITEMS_ASSIGNED"],
      effect: workerOptions.effects.working?.map((e) => [e.name, e.sends]),
    }).toEqual({
      inputs: ["p.ITEM_ARRIVED", "p.ITEMS_FINISHED", "p.ITEMS_FAILED", "p.ITEMS_RETURNED"],
      outputs: ["p.ITEMS_ASSIGNED"],
      targets: Array(4).fill(["empty", "holding"]),
      workerInputs: ["p.ITEMS_ASSIGNED"],
      workerOutputs: ["p.ITEMS_FINISHED", "p.ITEMS_FAILED", "p.ITEMS_RETURNED"],
      workerTargets: [["free"], ["free"]],
      assignTargets: ["working"],
      effect: [["runItems", ["p.RUN_SUCCEEDED", "p.RUN_FAILED"]]],
    });
  });
});
