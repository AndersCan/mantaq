import { createPool } from "./index.ts";
import { describe, expect, test } from "vite-plus/test";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createPool failures", () => {
  test.each([
    ["a string", "no"],
    ["undefined", undefined],
    ["an object", { code: 7 }],
    ["an Error", new Error("x")],
  ])(
    "a run that rejects with %s sends the items back and the pool carries on",
    async (_label, reason) => {
      const starts: string[][] = [];
      const pool = createPool<string, "p">({
        name: "p",
        workers: 1,
        run: (items) => {
          starts.push([...items]);
          return starts.length < 4 ? Promise.reject(reason) : Promise.resolve();
        },
      });
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
      await flush();
      expect({ starts, state: pool.actor.state.name }).toEqual({
        starts: [["a"], ["a"], ["a"], ["a"]],
        state: "allWorkersFree",
      });
    },
  );

  test("one worker failing does not stop the others", async () => {
    const starts: string[] = [];
    const pool = createPool<string, "p">({
      name: "p",
      workers: 2,
      run: ([item]) => {
        starts.push(item as string);
        return item === "bad" && starts.filter((s) => s === "bad").length === 1
          ? Promise.reject(new Error("bad"))
          : Promise.resolve();
      },
    });
    for (const item of ["bad", "good1", "good2"]) {
      pool.actor.send(pool.events.ITEM_ARRIVED.create({ item }));
    }
    await flush();
    expect(starts.sort()).toEqual(["bad", "bad", "good1", "good2"]);
    expect(pool.actor.state.name).toBe("allWorkersFree");
  });

  test("items sent to a disposed pool are dropped without a throw", () => {
    const pool = createPool<string, "p">({ name: "p", workers: 1, run: () => Promise.resolve() });
    pool.actor.dispose();
    pool.workers.dispose();
    expect(() => pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }))).not.toThrow();
  });
});
