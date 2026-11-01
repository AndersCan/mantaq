import type { AtlasInput } from "./atlas.ts";
import { createAuthActor } from "./fixtures/auth.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createCreditActor } from "./fixtures/credit.ts";
import { createRetryActor } from "./fixtures/retry.ts";
import { createSagaActor } from "./fixtures/saga.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import type { JourneySpec } from "./journey.ts";
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

const retryPayloads: Record<string, AtlasJson[]> = {
  failed: [{ reason: "timeout" }],
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
    target("retry", createRetryActor, retryPayloads),
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
  const r = (events: string[]) => sequence(events, retryPayloads);
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
      c(["submitBasicInfo", "submitShipping", "submitPayment", "paymentTimeout"]),
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
    retry: [r(["connect", "failed", "opened"])],
  };
}

type Narrated = [event: string, note: string];

interface JourneyText {
  id: string;
  title: string;
  description: string;
  inputs: Narrated[];
}

function journey(payloads: Record<string, AtlasJson[]>, spec: JourneyText): JourneySpec {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    inputs: spec.inputs.map(([event, note]) => ({ step: send(event, payloads), note })),
  };
}

function checkoutJourneys(): JourneySpec[] {
  const c = (spec: JourneyText) => journey(checkoutPayloads, spec);
  const toPayment: Narrated[] = [
    ["submitBasicInfo", "Customer enters name and email."],
    ["submitShipping", "Customer enters a shipping address."],
    ["submitPayment", "Customer submits card details; entering submitting charges the card."],
  ];
  return [
    c({
      id: "happy-path",
      title: "How we take a successful order",
      description: "Three form steps, then the card charge succeeds.",
      inputs: [...toPayment, ["paymentOk", "chargeCard reports success with an order id."]],
    }),
    c({
      id: "card-declined",
      title: "How we handle a declined card",
      description:
        "The charge fails; the customer lands on the error step and goes back to fix the card.",
      inputs: [
        ...toPayment,
        ["paymentFail", "chargeCard reports the card was declined."],
        ["back", "Customer goes back to the payment step to try another card."],
      ],
    }),
    c({
      id: "edit-address",
      title: "How a customer edits their address",
      description: "Back from payment clears the address so it is entered again.",
      inputs: [
        ["submitBasicInfo", "Customer enters name and email."],
        ["submitShipping", "Customer enters a shipping address."],
        ["back", "Customer goes back; the stored address is cleared."],
        ["submitShipping", "Customer enters the corrected address."],
      ],
    }),
  ];
}

function authJourneys(): JourneySpec[] {
  const a = (spec: JourneyText) => journey(authPayloads, spec);
  return [
    a({
      id: "sign-in",
      title: "How a user signs in",
      description: "Phone sign-in from a fresh app start.",
      inputs: [
        ["SIGN_IN", "User submits a phone number; entering signingIn starts signInWithPhone."],
        ["SIGN_IN_DONE", "signInWithPhone reports the user."],
      ],
    }),
    a({
      id: "sign-in-retry",
      title: "How we recover from a failed sign-in",
      description: "The first attempt fails; the user retries and gets in.",
      inputs: [
        ["SIGN_IN", "User submits a phone number."],
        ["SIGN_IN_ERROR", "signInWithPhone reports an error."],
        ["RETRY", "User taps retry; signInWithPhone runs again."],
        ["SIGN_IN_DONE", "This time it succeeds."],
      ],
    }),
    a({
      id: "sign-out",
      title: "How a user signs out",
      description: "Signed in, then out; MONITOR_TICK is handled anywhere without moving.",
      inputs: [
        ["SIGN_IN", "User submits a phone number."],
        ["SIGN_IN_DONE", "signInWithPhone reports the user."],
        ["MONITOR_TICK", "The auth monitor ticks; nothing changes."],
        ["SIGN_OUT", "User taps sign out; entering signingOut runs signOut."],
        ["SIGNING_OUT_DONE", "signOut finishes."],
      ],
    }),
  ];
}

function sagaJourneys(): JourneySpec[] {
  const s = (spec: JourneyText) => journey(sagaPayloads, spec);
  const reserved: Narrated[] = [
    ["START", "An order comes in; entering reservingInventory reserves stock."],
    ["INVENTORY_RESERVED", "Stock is reserved; entering processingPayment charges the customer."],
  ];
  return [
    s({
      id: "order-completes",
      title: "How an order goes through",
      description: "Reserve stock, charge, ship, notify.",
      inputs: [
        ...reserved,
        ["PAYMENT_PROCESSED", "Payment clears; entering creatingShipment books the carrier."],
        ["SHIPMENT_CREATED", "Carrier returns a tracking number; the customer is notified."],
        ["NOTIFICATION_SENT", "Notification delivered."],
      ],
    }),
    s({
      id: "payment-fails",
      title: "How we handle a failed payment",
      description: "Compensation runs in reverse: refund, then release the stock.",
      inputs: [
        ...reserved,
        ["PAYMENT_FAILED", "The card is declined; compensation starts with runRefund."],
        ["REFUND_DONE", "Refund settled; releaseInventory frees the reserved stock."],
        ["RELEASE_DONE", "Stock released; the saga ends failed."],
      ],
    }),
    s({
      id: "customer-cancels",
      title: "How we handle a cancellation mid-order",
      description: "Cancel after stock is reserved releases it.",
      inputs: [
        ...reserved,
        ["CANCEL", "Customer cancels; releaseInventory frees the stock."],
        ["RELEASE_DONE", "Stock released."],
      ],
    }),
  ];
}

function retryJourneys(): JourneySpec[] {
  return [
    {
      id: "lockout",
      title: "How we lock out after repeated failures",
      description: "Each failure counts; the 11th locks the connection until reset.",
      inputs: [
        { step: send("connect", retryPayloads), note: "Client starts connecting." },
        ...Array.from({ length: 11 }, (_, index) => ({
          step: send("failed", retryPayloads),
          note:
            index < 10
              ? `Attempt ${index + 1} fails; we keep trying.`
              : "Attempt 11 fails: locked out.",
        })),
        { step: send("reset", retryPayloads), note: "An operator resets the lock." },
      ],
    },
  ];
}

/**
 * Walkthroughs for readers: "here is how we handle X". Unlike the baselines
 * (coverage bar), these are written to explain, one note per input. Internal
 * events stand in for what the stubbed effect would report.
 */
export function exampleJourneys(): Record<string, JourneySpec[]> {
  return {
    checkout: checkoutJourneys(),
    auth: authJourneys(),
    saga: sagaJourneys(),
    retry: retryJourneys(),
  };
}

/** Structure-only inputs for the examples (fresh actors, no run). */
export function exampleInputs(): AtlasInput[] {
  return exampleTargets().map((each) => ({ id: each.id, actor: each.create().actor }));
}
