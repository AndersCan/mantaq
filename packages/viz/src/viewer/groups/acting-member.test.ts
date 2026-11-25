import { describe, expect, test } from "vite-plus/test";
import { edgeOf, machineOf, stateOf } from "./shop-machines.ts";
import { actingMember } from "./acting-member.ts";
import { movesFrom } from "../../moves.ts";

/** A cart whose checkout goes to one of two payment states, by a guard. */
const shop = machineOf({
  states: [stateOf("inCart", { initial: true }), stateOf("chargingCard"), stateOf("invoicing")],
  edges: [
    edgeOf("inCart", { event: "checkout", to: "chargingCard" }),
    edgeOf("inCart", { event: "checkout", to: "invoicing" }),
  ],
});

const members = ["inCart-checkout-chargingCard", "inCart-checkout-invoicing"];

function actingAt(state: string, blocked: ReadonlyMap<string, string>): string | undefined {
  const moves = movesFrom(shop, state);
  const sources = new Map<string, string>();
  for (const edge of shop.edges) sources.set(edge.id, edge.from);
  return actingMember(members, { moves, blocked, currents: [state], sources });
}

describe("the real edge a drawn arrow acts as", () => {
  test("is the first member no guard blocks, else the first the walk can take, else none", () => {
    const firstBlocked = new Map([["inCart-checkout-chargingCard", "no card on file"]]);
    const bothBlocked = new Map([...firstBlocked, ["inCart-checkout-invoicing", "no address"]]);
    expect({
      open: actingAt("inCart", new Map()),
      firstBlocked: actingAt("inCart", firstBlocked),
      bothBlocked: actingAt("inCart", bothBlocked),
      elsewhere: actingAt("invoicing", new Map()),
    }).toEqual({
      open: "inCart-checkout-chargingCard",
      firstBlocked: "inCart-checkout-invoicing",
      bothBlocked: "inCart-checkout-chargingCard",
      elsewhere: undefined,
    });
  });
});
