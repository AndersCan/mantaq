import type { AtlasInput } from "./atlas.ts";
import { createAuthActor } from "./fixtures/auth.ts";
import { createCheckoutActor, submitBasicInfo } from "./fixtures/checkout.ts";
import { createSagaActor } from "./fixtures/saga.ts";
import { instrument } from "@mantaq/traversal";

/** Checkout with a one-step run, so the export carries a coverage overlay to look at. */
function checkoutWithRun(): AtlasInput {
  const run = instrument(createCheckoutActor());
  run.send(submitBasicInfo.create({ email: "a@b.c" }));
  // Structure comes from a fresh actor: probing reads live state, so a used actor skews edges.
  return { id: "checkout", actor: createCheckoutActor(), history: run.history };
}

/** The three example machines the CLI exports by default. */
export function exampleInputs(): AtlasInput[] {
  return [
    checkoutWithRun(),
    { id: "auth", actor: createAuthActor() },
    { id: "saga", actor: createSagaActor() },
  ];
}
