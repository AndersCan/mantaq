import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { inspectModule } from "../inspect.ts";
import { loadSource } from "./program.ts";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

async function inspect(name: string) {
  const result = await inspectModule(join(FIXTURES, name), {
    load: (path) => import(path),
    fuzz: false,
  });
  const machine = result.machines[0];
  if (machine === undefined) throw new Error(`no machine in ${name}`);
  return machine;
}

describe("handlers registered in another file of the program", () => {
  test("a pool's handler is read from sugar, with the doc of its registration", async () => {
    const machine = await inspect("pool.ts");
    const edge = machine.edges.find((e) => e.id === "workersBusy-team.ITEM_ARRIVED-workWaiting");
    expect(edge?.doc).toBe("The item waits only if no worker is free.");
    const explanation = edge?.explanation;
    if (explanation?.status !== "analyzed") throw new Error("not analyzed");
    expect(explanation.location.file.endsWith("sugar/src/pool.ts")).toBe(true);
    expect(explanation.branches).toEqual([
      { conditions: ["next.waits"], target: { kind: "state", state: "workWaiting" } },
      { conditions: ["!(next.waits)"], target: { kind: "state", state: "workersBusy" } },
    ]);
  });

  test("events and states take the descriptions of the file that registers them", async () => {
    const machine = await inspect("pool.ts");
    expect(machine.events.find((e) => e.id === "team.ITEM_ARRIVED")?.doc).toBe(
      "App → inbox: one item to hand out.",
    );
    expect(machine.states.find((s) => s.id === "workers.free")?.doc).toBe(
      "The worker waits for an assignment.",
    );
  });

  test("a handler serving three states keeps only the branches to the states declared from that one", async () => {
    const machine = await inspect("pool.ts");
    const edge = machine.edges.find(
      (e) => e.id === "allWorkersFree-team.WORKERS_RESIZED-allWorkersFree",
    );
    const explanation = edge?.explanation;
    if (explanation?.status !== "analyzed") throw new Error("not analyzed");
    expect(explanation.branches.map((b) => b.target)).toEqual([
      { kind: "state", state: "allWorkersFree" },
    ]);
  });

  test("an event takes the registration written for it, not another event's", async () => {
    const machine = await inspect("pool.ts");
    const edge = machine.edges.find(
      (e) => e.id === "workersBusy-team.ITEMS_FINISHED-allWorkersFree",
    );
    expect(edge?.doc).toBe(
      "A running worker is free again. An id that is free or unknown changes nothing.",
    );
  });

  test("two other files registering the same state and event is not analyzed, naming both", async () => {
    const machine = await inspect("two-libs/app.ts");
    const edge = machine.edges.find((e) => e.event === "go");
    expect(edge?.explanation).toMatchObject({
      status: "not_analyzed",
      reason:
        "handlers for (idle, go) found in more than one file: src/fixtures/two-libs/left.ts, src/fixtures/two-libs/right.ts",
    });
  });

  test("the machine file's own registration wins over another file's", async () => {
    const machine = await inspect("two-libs/own.ts");
    const edge = machine.edges.find((e) => e.event === "go");
    expect(edge?.doc).toBe("Own goes.");
    expect(edge?.explanation?.status).toBe("analyzed");
  });

  test("a registration reads its event's doc and pattern; an undocumented plain event has neither doc nor pattern", () => {
    const pool = Either.getRight(
      loadSource({ file: join(FIXTURES, "pool.ts"), root: EXAMPLE_ROOT }),
    );
    const arrived = pool?.elsewhere
      .flatMap((other) => other.registrations)
      .find((registration) => registration.eventPattern === "^.+\\.ITEM_ARRIVED$");
    expect(arrived?.eventDoc).toBe("App → inbox: one item to hand out.");
    const left = Either.getRight(
      loadSource({ file: join(FIXTURES, "two-libs/left.ts"), root: EXAMPLE_ROOT }),
    );
    expect(left?.registrations.map((r) => [r.event, r.eventPattern, r.eventDoc])).toEqual([
      ["go", null, null],
    ]);
  });
});
