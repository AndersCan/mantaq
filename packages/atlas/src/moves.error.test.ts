import { toAtlasMachine } from "./atlas.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { decodePath, movesFrom } from "./moves.ts";
import { describe, expect, test } from "vite-plus/test";

describe("decodePath stops at the first step the graph does not allow", () => {
  const machine = toAtlasMachine({ id: "checkout", actor: createCheckoutActor() });
  const first = movesFrom(machine, "basicInfo")[0]?.edge.id ?? "";

  test("unknown edge, edge from another state, or a target the edge cannot reach", () => {
    expect(decodePath(machine, ["no-such-edge", first])).toEqual([]);
    expect(decodePath(machine, [first, first])).toHaveLength(1);
    expect(decodePath(machine, [`${first}~payment`])).toEqual([]);
  });

  test("unknown state or no initial state: nothing to walk", () => {
    expect(movesFrom(machine, "nowhere")).toEqual([]);
    expect(decodePath({ ...machine, initial: null }, [first])).toEqual([]);
  });
});
