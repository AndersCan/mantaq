import { VirtualClock } from "@mantaq/core";
import { systemOf } from "@mantaq/viz";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createKitchen } from "./fixtures/kitchen.ts";
import { toViz } from "./structure.ts";
import { normalizeRun } from "./runs.ts";
import { execute } from "./fuzz/run.ts";
import { Either } from "@mantaq/utils";

function kitchen() {
  const clock = VirtualClock();
  const made = createKitchen({ clock });
  return { actor: made.actor, clock, made };
}

const order = { kind: "event", event: "ORDER_PLACED", payload: { dish: "soup" } } as const;

describe("a kitchen and the pool it feeds, as one board", () => {
  const machine = toViz([{ id: "kitchen", ...kitchen() }]).machines[0]!;

  test("the returned pool inbox is a part with its own states and no coverage", () => {
    expect(machine.actors).toEqual(["orders"]);
    expect(machine.maps).toEqual(["cooks"]);
    expect(machine.regions).toEqual(["cooks", "orders"]);
    const inbox = machine.states.filter((each) => each.region === "orders");
    expect(inbox.map((each) => each.id)).toEqual([
      "orders.allWorkersFree",
      "orders.workWaiting",
      "orders.workersBusy",
    ]);
    expect(inbox.map((each) => each.coverage)).toEqual([null, null, null]);
    expect(machine.initial).toBe("takingOrders");
    expect(machine.states.find((each) => each.id === "orders.allWorkersFree")?.initial).toBe(true);
    expect(machine.partOutputs["orders"]).toEqual(["orders.ITEMS_ASSIGNED"]);
  });

  test("the arrows run kitchen to orders, orders to cooks and cooks back", () => {
    const system = systemOf(machine);
    expect(system.parts.map((part) => [part.id, part.kind, part.within, part.alone])).toEqual([
      ["", "root", "orders", false],
      ["cooks", "map", "orders", false],
      ["orders", "actor", null, false],
    ]);
    expect(
      system.links.map((link) => `${link.from || "kitchen"} → ${link.to || "kitchen"}`),
    ).toEqual(["kitchen → orders", "cooks → orders", "cooks → orders", "orders → cooks"]);
  });

  test("drawn as a plain region, the inbox's output goes only to its parent, so no arrow reaches the cooks", () => {
    const system = systemOf({ ...machine, actors: [] });
    expect(system.links.find((link) => link.from === "orders")?.to).toBeNull();
  });
});

describe("driving the returned machine", () => {
  test("two orders leave the inbox busy and two cooks working", () => {
    const driver = createDriver({ id: "kitchen", create: kitchen });
    driver.step(order);
    const live = driver.step(order);
    expect(live.regions["orders"]).toBe("orders.workersBusy");
    expect(live.children.map((each) => [each.key, each.state])).toEqual([
      ["w1", "cooks.working"],
      ["w2", "cooks.working"],
    ]);
  });

  test("a step sent to the inbox by name shrinks the pool once the clock moves", async () => {
    const driver = createDriver({ id: "kitchen", create: kitchen }, { effectMode: "real" });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    driver.step(order);
    driver.step(order);
    await tick();
    const resized = driver.step({
      kind: "event",
      event: "orders.WORKERS_RESIZED",
      payload: { count: 1 },
      actor: { region: "orders" },
    });
    expect(resized.children.map((each) => each.key)).toEqual(["w1", "w2"]);
    driver.step({ kind: "advance", ms: 1000 });
    await tick();
    const live = driver.step({ kind: "advance", ms: 0 });
    expect(live.children.map((each) => each.key)).toEqual(["w1"]);
    expect(live.regions["orders"]).toBe("orders.allWorkersFree");
  });

  test("the board is told when a cook leaves, without another step", async () => {
    const driver = createDriver({ id: "kitchen", create: kitchen }, { effectMode: "real" });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const seen: string[][] = [];
    driver.listen?.((state) => seen.push(state.children.map((each) => each.key)));
    driver.step(order);
    driver.step(order);
    await tick();
    driver.step({
      kind: "event",
      event: "orders.WORKERS_RESIZED",
      payload: { count: 1 },
      actor: { region: "orders" },
    });
    driver.step({ kind: "advance", ms: 1000 });
    await tick();
    expect(seen.at(-1)).toEqual(["w1"]);
  });

  test("reset disposes the inbox and starts a fresh one", () => {
    const driver = createDriver({ id: "kitchen", create: kitchen });
    driver.step(order);
    const live = driver.reset();
    expect(live.regions["orders"]).toBe("orders.allWorkersFree");
    expect(live.children.map((each) => each.state)).toEqual(["cooks.free", "cooks.free"]);
  });
});

describe("a step sent to a returned machine", () => {
  test("a recorded run with a step on the inbox replays", () => {
    const target = { id: "kitchen", create: kitchen };
    const result = normalizeRun(target, {
      name: "resize",
      steps: [
        order,
        {
          kind: "event",
          event: "orders.WORKERS_RESIZED",
          payload: { count: 1 },
          actor: { region: "orders" },
        },
      ],
      end: "takingOrders",
    });
    expect(Either.isRight(result)).toBe(true);
  });

  test("a step naming a part the factory did not return is refused", () => {
    const result = normalizeRun(
      { id: "kitchen", create: kitchen },
      {
        name: "nobody",
        steps: [{ kind: "event", event: "x", payload: null, actor: { region: "nobody" } }],
        end: "takingOrders",
      },
    );
    expect(Either.getLeft(result)).toBe('unknown region "nobody"');
  });

  test("the fuzzer reaches the inbox directly with a step that names it", () => {
    const result = execute({ id: "kitchen", create: kitchen }, [
      order,
      {
        kind: "event",
        event: "orders.ITEMS_FINISHED",
        payload: { worker: "w1" },
        actor: { region: "orders" },
      },
    ]);
    expect(result.visited).toContain("orders.allWorkersFree");
    expect(result.observations.some((each) => each.from.startsWith("orders."))).toBe(true);
  });
});
