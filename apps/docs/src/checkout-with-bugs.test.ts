import { designErrors, inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./content/docs/checkout-with-bugs.ts", import.meta.url).pathname;

test("the Design gate page shows the three planted bugs", async () => {
  const result = await inspectModule(file, {
    load: (path) => import(path),
    fuzz: { seed: 1, iterations: 5000 },
  });
  // The planted bugs leave archived and the throwing back edge unreached.
  expect(result.warnings).toEqual([
    "checkoutWithBugs: fuzz never reached: archived, payment -back-> shippingAddress (ran 5000 iterations, stopped: iteration cap). Raise fuzz.timeLimitMs / iterations or add a named run to `tests`.",
  ]);
  const machine = result.machines[0]!;
  expect(designErrors(machine)).toEqual([
    'back in payment throws. Fuzzing sent back in payment and the handler threw "Error: the shipping address was lost", so the actor went to __error. Handle the failure in the handler and return a state for it.',
    'payment was reached with {"address":""}. The expectations block says payment must never see {"address":""}, and a fuzz run got there. Reject that input in the handler that leads to payment, or change the expectation.',
    "archived can never be reached. No transition leads into archived. From basicInfo, the machine can only reach basicInfo, payment and shippingAddress. Add a transition into archived, or remove it.",
  ]);
  const hit = machine.fuzz?.failedExpectations[0];
  expect(hit?.steps).toEqual([
    { kind: "event", event: "submitBasicInfo", payload: { email: "sample" } },
    { kind: "event", event: "submitShipping", payload: { address: "" } },
  ]);
});
