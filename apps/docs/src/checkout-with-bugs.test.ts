import { designErrors, inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./content/docs/checkout-with-bugs.ts", import.meta.url).pathname;

test("the Design gate page shows the six planted bugs", async () => {
  const result = await inspectModule(file, {
    load: (path) => import(path),
    fuzz: { seed: 1, iterations: 5000 },
  });
  expect(result.warnings).toEqual([
    "checkoutWithBugs: fuzz never reached: refunded, refunding, payment -back-> shippingAddress (ran 5000 iterations, stopped: iteration cap). Raise fuzz.timeLimitMs / iterations or add a named run to `tests`.",
  ]);
  const machine = result.machines[0]!;
  expect(designErrors(machine)).toEqual([
    'back in payment throws. Fuzzing sent back in payment and the handler threw "Error: the shipping address was lost", so the actor went to __error. Handle the failure in the handler and return a state for it.',
    'payment was reached with {"address":""}. The expectations block says payment must never see {"address":""}, and a fuzz run got there. Reject that input in the handler that leads to payment, or change the expectation.',
    "paymentDeclined is a dead end. The machine gets to paymentDeclined by cardDeclined in payment, but nothing can happen there: no event is handled, no effect runs, and it is not final. Handle an event in paymentDeclined, or make it final.",
    "refunded can never be reached. Only refundIssued in refunding leads into refunded, and refunding can never be reached either. From basicInfo, the machine can only reach basicInfo, orderPlaced, payment, paymentDeclined and shippingAddress. Make refunding reachable, or remove refunded.",
    "refunding can never be reached. No transition leads into refunding. From basicInfo, the machine can only reach basicInfo, orderPlaced, payment, paymentDeclined and shippingAddress. Add a transition into refunding, or remove it.",
    "cancelOrder is declared but no state handles it. cancelOrder is an input of checkoutWithBugs, but no state has a handler for it, so sending it does nothing. Handle cancelOrder in a state, or remove it from inputs.",
  ]);
  const hit = machine.fuzz?.failedExpectations[0];
  expect(hit?.steps).toEqual([
    { kind: "event", event: "submitBasicInfo", payload: { email: "samplex" } },
    { kind: "event", event: "submitShipping", payload: { address: "" } },
  ]);
}, 60_000);
