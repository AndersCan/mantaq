/**
 * Shared checkout example for the Mantaq docs.
 *
 * This module is the single source of truth for the running checkout machine
 * used across the narrative docs (apps/docs). It mirrors the canonical example
 * in `packages/examples/checkout.test.ts` (which `scripts/docs-check.mjs` Gate C
 * typechecks and Gate A uses as the ID registry). Import the pieces you need
 * instead of re-declaring the machine inline, so the example stays in one place.
 *
 * Story: a multi-step checkout form.
 *
 *   basicInfo -> shippingAddress -> payment -> submitting -> success (final)
 *                                      ^ (back) v                  v (back)
 *                                                               error
 */
import { Actor, VirtualClock } from "@mantaq/core";
export type BasicInfo = {
  /** @example ana@example.com */
  email: string;
  /** @example Ana Lima */
  name: string;
};
export type ShippingAddress = {
  /** @example 1 Main Street */
  street: string;
  /** @example Lisbon */
  city: string;
  /** @example 1000-001 */
  zip: string;
};
export type PaymentInfo = {
  /** @example 4242 4242 4242 4242 */
  cardNumber: string;
};
export type CheckoutContext = {
  basicInfo?: BasicInfo;
  shippingAddress?: ShippingAddress;
  paymentInfo?: PaymentInfo;
  orderId?: string;
};
/** The visitor enters their name and email. */
export declare const basicInfo: import("@mantaq/core").StateRef<"basicInfo", unknown, false>;
/** The visitor enters where to ship the order. */
export declare const shippingAddress: import("@mantaq/core").StateRef<
  "shippingAddress",
  unknown,
  false
>;
/** The visitor enters their card details. */
export declare const payment: import("@mantaq/core").StateRef<"payment", unknown, false>;
/** The card is being charged; the visitor waits. */
export declare const submitting: import("@mantaq/core").StateRef<"submitting", unknown, false>;
/** The order went through. */
export declare const success: import("@mantaq/core").StateRef<"success", unknown, true>;
/** The payment failed and the visitor sees why. */
export declare const error: import("@mantaq/core").StateRef<"error", unknown, false>;
/** The visitor sent their name and email. */
export declare const submitBasicInfo: import("@mantaq/core").EventRef<"submitBasicInfo", BasicInfo>;
/** The visitor sent their shipping address. */
export declare const submitShipping: import("@mantaq/core").EventRef<
  "submitShipping",
  ShippingAddress
>;
/** The visitor sent their card details. */
export declare const submitPayment: import("@mantaq/core").EventRef<"submitPayment", PaymentInfo>;
/** The visitor went back a step. */
export declare const back: import("@mantaq/core").EventRef<"back", void>;
/** The card was charged. */
export declare const paymentOk: import("@mantaq/core").EventRef<
  "paymentOk",
  {
    /** @example ord_4242 */
    orderId: string;
  }
>;
/** The card was declined. */
export declare const paymentFail: import("@mantaq/core").EventRef<
  "paymentFail",
  {
    /** @example Card declined */
    reason: string;
  }
>;
/** The card charge took too long. */
export declare const paymentTimeout: import("@mantaq/core").EventRef<"paymentTimeout", void>;
export declare function chargeCard(cardNumber: string): Promise<string>;
export declare function createCheckoutActor(options?: {
  clock?: VirtualClock;
  chargeCard?: typeof chargeCard;
}): {
  actor: Actor<
    readonly [
      import("@mantaq/core").StateRef<"basicInfo", unknown, false>,
      import("@mantaq/core").StateRef<"shippingAddress", unknown, false>,
      import("@mantaq/core").StateRef<"payment", unknown, false>,
      import("@mantaq/core").StateRef<"submitting", unknown, false>,
      import("@mantaq/core").StateRef<"success", unknown, true>,
      import("@mantaq/core").StateRef<"error", unknown, false>,
    ],
    readonly [
      import("@mantaq/core").EventRef<"submitBasicInfo", BasicInfo>,
      import("@mantaq/core").EventRef<"submitShipping", ShippingAddress>,
      import("@mantaq/core").EventRef<"submitPayment", PaymentInfo>,
      import("@mantaq/core").EventRef<"back", void>,
    ],
    readonly [
      import("@mantaq/core").EventRef<
        "paymentOk",
        {
          /** @example ord_4242 */
          orderId: string;
        }
      >,
      import("@mantaq/core").EventRef<
        "paymentFail",
        {
          /** @example Card declined */
          reason: string;
        }
      >,
      import("@mantaq/core").EventRef<"paymentTimeout", void>,
    ],
    readonly [],
    CheckoutContext
  >;
  clock: VirtualClock;
};
export declare const checkout: Actor<
  readonly [
    import("@mantaq/core").StateRef<"basicInfo", unknown, false>,
    import("@mantaq/core").StateRef<"shippingAddress", unknown, false>,
    import("@mantaq/core").StateRef<"payment", unknown, false>,
    import("@mantaq/core").StateRef<"submitting", unknown, false>,
    import("@mantaq/core").StateRef<"success", unknown, true>,
    import("@mantaq/core").StateRef<"error", unknown, false>,
  ],
  readonly [
    import("@mantaq/core").EventRef<"submitBasicInfo", BasicInfo>,
    import("@mantaq/core").EventRef<"submitShipping", ShippingAddress>,
    import("@mantaq/core").EventRef<"submitPayment", PaymentInfo>,
    import("@mantaq/core").EventRef<"back", void>,
  ],
  readonly [
    import("@mantaq/core").EventRef<
      "paymentOk",
      {
        /** @example ord_4242 */
        orderId: string;
      }
    >,
    import("@mantaq/core").EventRef<
      "paymentFail",
      {
        /** @example Card declined */
        reason: string;
      }
    >,
    import("@mantaq/core").EventRef<"paymentTimeout", void>,
  ],
  readonly [],
  CheckoutContext
>;
