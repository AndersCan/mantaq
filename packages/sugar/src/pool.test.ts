import { createPool } from "./index.ts";
import { onOutput } from "./output.ts";
import { Actor, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

describe("types", () => {
  test("rejects a wrong item, a wrong payload and a worker-only event on the inbox", () => {
    const run = () => Promise.resolve();
    const pool = createPool<string, "p">({ name: "p", workers: 1, run });
    // @ts-expect-error the item type is string
    pool.events.ITEM_ARRIVED.create({ item: 5 });
    // @ts-expect-error the payload needs `item`
    pool.events.ITEM_ARRIVED.create({});
    // @ts-expect-error the inbox does not take ITEMS_ASSIGNED
    pool.actor.send(pool.events.ITEMS_ASSIGNED.create({ worker: "w1", items: [] }));
    // @ts-expect-error the inbox does not take RUN_SUCCEEDED
    pool.actor.send(pool.events.RUN_SUCCEEDED.create());
    expect(pool.events.ITEM_ARRIVED.type).toBe("p.ITEM_ARRIVED");
  });

  test("onOutput takes an actor whose context is an interface", () => {
    interface Shape {
      n: number;
    }
    const on = state("on")();
    const out = event("out")();
    const actor = Actor({
      inputs: [],
      outputs: [out],
      states: [on],
      initial: on,
      context: { n: 1 } as Shape,
      setup: () => {},
    });
    onOutput(actor, () => {});
    expect(actor.state.name).toBe("on");
  });
});
