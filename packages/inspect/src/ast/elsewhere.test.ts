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

  test("a registration reads its event's doc and pattern; an undocumented plain event has neither doc nor pattern", () => {
    const pool = Either.getRight(
      loadSource({ file: join(FIXTURES, "pool.ts"), root: EXAMPLE_ROOT }),
    );
    const arrived = pool?.elsewhere
      .flatMap((other) => other.registrations)
      .find((registration) => registration.eventPattern === "^.+\\.ITEM_ARRIVED$");
    expect(arrived?.eventDoc).toBe("App → inbox: one item to hand out.");
    const left = Either.getRight(
      loadSource({ file: join(FIXTURES, "lend/child.ts"), root: EXAMPLE_ROOT }),
    );
    expect(left?.registrations.map((r) => [r.event, r.eventPattern, r.eventDoc])).toEqual([
      ["go", null, null],
    ]);
  });

  test("a copied draft is read from the file the root imports, not the original another file imports", async () => {
    const result = await inspectModule(join(FIXTURES, "drafts/app.design-a.ts"), {
      load: (path) => import(path),
      fuzz: false,
    });
    const edge = result.machines[0]?.edges.find((e) => e.event === "go");
    expect(edge?.doc).toBe("The draft starts the work.");
    expect(edge?.explanation?.status).toBe("analyzed");
  });

  const goEdge = async (file: string) => {
    const result = await inspectModule(join(FIXTURES, file), {
      load: (path) => import(path),
      fuzz: false,
    });
    return result.machines[0]?.edges.find((e) => e.event === "go");
  };

  test("an unrelated actor the root only names a constant of does not lend its handler", async () => {
    const edge = await goEdge("unrelated/app.ts");
    expect(edge?.doc).toBe("Y starts the work.");
  });

  test("a file reached through a re-export counts as that many imports away", async () => {
    const edge = await goEdge("barrel/app.ts");
    expect(edge?.doc).toBe("The original starts the work.");
  });

  test("a file the import walk never reaches ranks after one it does", async () => {
    const edge = await goEdge("barrel/app.dynamic.ts");
    expect(edge?.doc).toBe("The original starts the work.");
  });
});
