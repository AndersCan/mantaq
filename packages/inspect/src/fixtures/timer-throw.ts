/**
 * An effect whose timer callback reads the payload the handler stored. Sent
 * without a payload, the callback throws under `clock.advance`, outside the
 * handler and effect body core guards. `refunded` has no way in, so fuzz never
 * reaches full coverage and cannot stop before it finds the crash.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

type Payment = { card: string };

const idle = state("idle")();
const charging = state("charging")();
const paid = state("paid")();
const declined = state("declined")();
const refunded = state("refunded")();

const pay = event("pay")<Payment>();
const ok = event("ok")();
const no = event("no")();

export function createTimerThrowActor(clock: VirtualClock = VirtualClock()) {
  const initial: { payment: Payment } = { payment: { card: "" } };
  return Actor({
    inputs: [pay],
    internal: [ok, no],
    states: [idle, charging, paid, declined, refunded],
    initial: idle,
    clock,
    context: initial,
    setup: (m) => {
      m.on(idle, {
        event: pay,
        to: [charging],
        handler: (e, { context }) => {
          context.set({ payment: e.payload });
          return { state: charging };
        },
      });
      m.effect(charging, {
        name: "charge",
        sends: [ok, no],
        fn: ({ context, clock: timers, emit, signal }) => {
          timers.setTimeout(10, {
            signal,
            cb: () =>
              emit((context.get().payment.card.startsWith("4") ? ok : no).create(undefined)),
          });
        },
      });
      m.on(charging, { event: ok, to: [paid], handler: () => ({ state: paid }) });
      m.on(charging, { event: no, to: [declined], handler: () => ({ state: declined }) });
    },
  });
}
