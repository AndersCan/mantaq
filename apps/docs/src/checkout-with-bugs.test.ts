import { designErrors, inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./content/docs/checkout-with-bugs.ts", import.meta.url).pathname;

test("the Design gate page shows the three planted bugs", async () => {
  const result = await inspectModule(file, {
    load: (path) => import(path),
    fuzz: { seed: 1, iterations: 5000 },
  });
  expect(result.warnings).toEqual([]);
  const machine = result.machines[0]!;
  expect(designErrors(machine)).toEqual([
    "back in payment throws: Error: the shipping address was lost",
    'state payment reached never-see context {"address":""}',
    "state archived is declared but no path leads to it from the initial state",
  ]);
  const hit = machine.fuzz?.failedExpectations[0];
  expect(hit?.steps).toEqual([
    { kind: "event", event: "submitBasicInfo", payload: { email: "sample" } },
    { kind: "event", event: "submitShipping", payload: { address: "" } },
  ]);
});
