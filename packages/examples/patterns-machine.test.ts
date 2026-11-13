import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";

// patterns.md "Async Work" snippet
const submit = event("SUBMIT")();
const fillingForm = state("fillingForm")();
const submitting = state("submitting")();
const submitted = state("submitted")().final();
const submittingDone = event("SUBMITTING_DONE")();

test("testing.md VirtualClock test passes on the patterns.md machine", () => {
  const clock = VirtualClock();
  const actor = Actor({
    inputs: [submit],
    internal: [submittingDone],
    states: [fillingForm, submitting, submitted],
    initial: fillingForm,
    clock,
    setup: (m) => {
      m.on(fillingForm, {
        event: submit,
        to: [submitting],
        handler: () => ({ state: submitting }),
      });
      m.effect(submitting, {
        name: "startSubmitTimeout",
        sends: [submittingDone],
        fn: (input) => withTimeout(800, { input, event: () => submittingDone.create() }),
      });
      m.on(submitting, {
        event: submittingDone,
        to: [submitted],
        handler: () => ({ state: submitted }),
      });
    },
  });
  actor.send(submit.create());
  clock.advance(800);
  expect(matches(actor, "submitted")).toBe(true);
});
