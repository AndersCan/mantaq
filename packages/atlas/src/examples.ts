import type { AtlasInput } from "./atlas.ts";
import { createAuthActor } from "./fixtures/auth.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createCreditActor } from "./fixtures/credit.ts";
import { createSagaActor } from "./fixtures/saga.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import type { AtlasJson, AtlasStep } from "./schema.ts";
import { VirtualClock } from "@mantaq/core";
import { join, resolve } from "node:path";
import type { AnyActor } from "@mantaq/core";

/**
 * Sample payloads are copied from the example tests. They are the fuzzer's
 * only knowledge of payload shape (types are erased at runtime).
 */
const checkoutPayloads: Record<string, AtlasJson[]> = {
  submitBasicInfo: [{ email: "a@b.com", name: "A" }],
  submitShipping: [{ street: "123", city: "C", zip: "12345" }],
  submitPayment: [{ cardNumber: "1111222233334444" }],
  paymentOk: [{ orderId: "ord_4444" }],
  paymentFail: [{ reason: "declined" }],
};

const authPayloads: Record<string, AtlasJson[]> = {
  SIGN_IN: [{ phoneNumber: "+1234567890" }],
  SIGN_IN_DONE: [{ user: { uid: "user-1", email: "user1@example.com", phone: "+1234567890" } }],
  USER_SIGNED_IN: [{ user: { uid: "user-1", email: "user1@example.com" } }],
  SIGN_IN_ERROR: [{ error: "Sign in failed" }],
};

const sagaPayloads: Record<string, AtlasJson[]> = {
  START: [{ order: { orderId: "ORD-1", items: ["widget"], amount: 100 } }],
  INVENTORY_RESERVED: [{ result: { reservationId: "RES-ORD-1" } }],
  INVENTORY_FAILED: [{ error: "Out of stock" }],
  PAYMENT_PROCESSED: [{ result: { transactionId: "TXN-ORD-1" } }],
  PAYMENT_FAILED: [{ error: "Card declined" }],
  SHIPMENT_CREATED: [{ result: { trackingNumber: "TRK-ORD-1" } }],
  SHIPMENT_FAILED: [{ error: "Carrier unavailable" }],
  NOTIFICATION_FAILED: [{ error: "Email bounce" }],
  REFUND_FAILED: [{ error: "Refund declined" }],
  RELEASE_FAILED: [{ error: "Release declined" }],
};

const creditPayloads: Record<string, AtlasJson[]> = {
  setTier: [{ tier: "silver" }],
  apply: [{ score: 720, amount: 1000 }],
  decide: [{ approve: true }],
};

/** Repo root: AST locations are reported relative to it. */
export const EXAMPLE_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const FIXTURES = join(import.meta.dirname, "fixtures");

/** An example machine: fuzz target plus the file that registers its handlers. */
export interface Example extends FuzzTarget {
  source: string;
}

function target(
  id: string,
  create: (clock: VirtualClock) => AnyActor<unknown>,
  payloads: Record<string, AtlasJson[]>,
): Example {
  return {
    id,
    source: join(FIXTURES, `${id}.ts`),
    create: () => {
      const clock = VirtualClock();
      return { actor: create(clock), clock };
    },
    payloads,
  };
}

export function exampleTargets(): Example[] {
  return [
    target("checkout", createCheckoutActor, checkoutPayloads),
    target("auth", createAuthActor, authPayloads),
    target("saga", createSagaActor, sagaPayloads),
    target("credit", createCreditActor, creditPayloads),
  ];
}

function send(event: string, payloads: Record<string, AtlasJson[]>): AtlasStep {
  return { kind: "event", event, payload: payloads[event]?.[0] ?? null };
}

function sequence(events: string[], payloads: Record<string, AtlasJson[]>): AtlasStep[] {
  return events.map((event) => send(event, payloads));
}

/**
 * The hand-written example tests, transcribed to fixture-level steps. Where a
 * test waits for an effect (timer, promise), the step injects the internal
 * event that effect would emit. Used as the coverage bar the fuzzer must meet.
 */
export function handWrittenBaselines(): Record<string, AtlasStep[][]> {
  const c = (events: string[]) => sequence(events, checkoutPayloads);
  const a = (events: string[]) => sequence(events, authPayloads);
  const s = (events: string[]) => sequence(events, sagaPayloads);
  const cr = (events: string[]) => sequence(events, creditPayloads);
  const signedIn = ["SIGN_IN", "SIGN_IN_DONE"];
  const reserved = ["START", "INVENTORY_RESERVED"];
  const paid = [...reserved, "PAYMENT_PROCESSED"];
  const shipped = [...paid, "SHIPMENT_CREATED"];
  return {
    checkout: [
      c(["submitBasicInfo", "submitShipping", "submitPayment", "paymentOk"]),
      c(["submitBasicInfo", "submitShipping", "submitPayment"]),
      c(["submitBasicInfo", "back"]),
      c(["submitBasicInfo", "submitShipping", "back"]),
      c(["submitBasicInfo", "submitShipping", "submitPayment", "submittingDone"]),
    ],
    auth: [
      a(["MONITOR_TICK"]),
      a(signedIn),
      a(["SIGN_IN", "SIGN_IN_ERROR"]),
      a([...signedIn, "SIGN_OUT", "SIGNING_OUT_DONE", ...signedIn]),
      a([...signedIn, "SIGN_OUT", "SIGNING_OUT_DONE"]),
      a(["SIGN_IN", "SIGN_IN_ERROR", "RETRY", "SIGN_IN_DONE"]),
      a(["SIGN_IN", "SIGN_IN_ERROR", ...signedIn]),
    ],
    saga: [
      [],
      s([...shipped, "NOTIFICATION_SENT"]),
      s([...reserved, "PAYMENT_FAILED", "REFUND_DONE", "RELEASE_DONE"]),
      s([...paid, "SHIPMENT_FAILED", "REFUND_DONE", "RELEASE_DONE"]),
      s(["START", "INVENTORY_FAILED"]),
      s(["CANCEL"]),
      s([...reserved, "CANCEL", "RELEASE_DONE"]),
      s([...shipped, "NOTIFICATION_FAILED"]),
    ],
    // No example test file: the sample path a reader would write first.
    credit: [cr(["apply", "reset"]), cr(["setTier"])],
  };
}

/** Structure-only inputs for the examples (fresh actors, no run). */
export function exampleInputs(): AtlasInput[] {
  return exampleTargets().map((each) => ({ id: each.id, actor: each.create().actor }));
}
