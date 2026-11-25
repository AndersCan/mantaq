import { describe, expect, test } from "vite-plus/test";
import { checkoutOf } from "./group-document.ts";
import { Either } from "@mantaq/utils";
import { validateViz } from "../validate.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";

describe("validateViz accepts state groups", () => {
  test("groups of one or more states, each in one scope, keep their names", () => {
    const states = [
      { id: "cart" },
      { id: "paying", group: "payment" },
      { id: "charged", group: "payment" },
      { id: "shipping.packing", group: "shipping-desk" },
      { id: "orders.placing" },
    ];
    const parsed = validateViz({
      schemaVersion: VIZ_SCHEMA_VERSION,
      machines: [checkoutOf(states, { regions: ["orders", "shipping"], maps: ["orders"] })],
    });
    const groups = (Either.getRight(parsed)?.machines[0]?.states ?? []).map((state) => [
      state.id,
      state.group,
    ]);
    expect(groups).toEqual([
      ["cart", undefined],
      ["paying", "payment"],
      ["charged", "payment"],
      ["shipping.packing", "shipping-desk"],
      ["orders.placing", undefined],
    ]);
  });
});
