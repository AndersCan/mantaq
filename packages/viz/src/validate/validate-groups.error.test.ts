import { checkoutOf, stateOf } from "./group-document.ts";
import { describe, expect, test } from "vite-plus/test";
import type { ShopParts, ShopState } from "./group-document.ts";
import { Either } from "@mantaq/utils";
import { validateViz } from "../validate.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";

function issuesOf(value: unknown): string[] {
  return (Either.getLeft(validateViz(value)) ?? []).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
}

function issuesFor(states: ShopState[], parts: ShopParts = {}): string[] {
  return issuesOf({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkoutOf(states, parts)] });
}

describe("validateViz rejects state groups", () => {
  test("an empty group name", () => {
    expect(issuesFor([{ id: "cart" }, { id: "paying", group: "" }])).toEqual([
      "$.machines[0].states[1].group: empty group name",
    ]);
  });

  test("a group name with a dot", () => {
    expect(issuesFor([{ id: "paying", group: "payment.card" }])).toEqual([
      '$.machines[0].states[0].group: group name "payment.card" contains "."',
    ]);
  });

  test("a group whose states sit in two region scopes, at each state outside the first scope", () => {
    const states = [
      { id: "paying", group: "payment" },
      { id: "shipping.packing", group: "payment" },
      { id: "charged", group: "payment" },
      { id: "shipping.sent", group: "payment" },
    ];
    expect(issuesFor(states, { regions: ["shipping"] })).toEqual([
      '$.machines[0].states[1].group: group "payment" is in region "shipping", but states[0] puts it in the root',
      '$.machines[0].states[3].group: group "payment" is in region "shipping", but states[0] puts it in the root',
    ]);
  });

  test("a group in an actor map, also below a region of the map's child", () => {
    const states = [
      { id: "orders.placing", group: "placed" },
      { id: "orders.billing.sending", group: "billing" },
    ];
    expect(issuesFor(states, { regions: ["orders", "orders.billing"], maps: ["orders"] })).toEqual([
      '$.machines[0].states[0].group: group "placed" is in actor map "orders"',
      '$.machines[0].states[1].group: group "billing" is in actor map "orders"',
    ]);
  });

  test("a group that is not a string", () => {
    const document = {
      schemaVersion: VIZ_SCHEMA_VERSION,
      machines: [{ ...checkoutOf([]), states: [{ ...stateOf({ id: "paying" }), group: 7 }] }],
    };
    expect(issuesOf(document)).toEqual(["$.machines[0].states[0].group: expected string"]);
  });
});
