/**
 * Credit check: branchy handlers on payload and context. Probing with `{}`
 * sees only the fall-through branch; the AST and fuzzer must find the rest.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

type CreditContext = { tier: string };

const idle = state("idle")();
const manualReview = state("manualReview")();
const approved = state("approved")();
const rejected = state("rejected")();

const setTier = event("setTier")<{ tier: string }>();
const apply = event("apply")<{ score: number; amount: number }>();
const decide = event("decide")<{ approve: boolean }>();
const reset = event("reset")();

/** Declared elsewhere on purpose: the AST pass reports it as not analyzed. */
function resetHandler() {
  return { state: idle };
}

export function createCreditActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: CreditContext = { tier: "standard" };
  return Actor({
    inputs: [setTier, apply, decide, reset],
    states: [idle, manualReview, approved, rejected],
    initial: idle,
    clock,
    context: initialContext,
    setup: (m) => {
      m.on(idle, {
        event: setTier,
        handler: (event, { context }) => {
          const current = context.get();
          current.tier = event.payload.tier;
          context.set(current);
          return {};
        },
      });
      m.on(idle, {
        event: apply,
        to: [manualReview, approved, rejected],
        handler: (event, { context }) => {
          const { score, amount } = event.payload;
          if (score < 600) return { state: rejected };
          if (amount > 50000 && context.get().tier !== "gold") return { state: manualReview };
          return { state: approved };
        },
      });
      m.on(manualReview, {
        event: decide,
        to: [approved, rejected],
        handler: (event) => ({ state: event.payload.approve ? approved : rejected }),
      });
      m.on(approved, { event: reset, to: [idle], handler: resetHandler });
      m.on(rejected, { event: reset, to: [idle], handler: resetHandler });
    },
  });
}
