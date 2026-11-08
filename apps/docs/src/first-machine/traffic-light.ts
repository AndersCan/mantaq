import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

/** Cars stop. */
const red = state("red")();
/** Cars go. */
const green = state("green")();
/** Cars slow down: red is next. */
const yellow = state("yellow")();
/** The light is switched off for good. */
const off = state("off")().final();

/** Someone switched the light off. */
export const switchOff = event("switchOff")();
/** The current colour has been on long enough. */
const timeUp = event("timeUp")();

export function createTrafficLight(clock: Clock) {
  return Actor({
    inputs: [switchOff],
    internal: [timeUp],
    states: [red, green, yellow, off],
    initial: red,
    clock,
    setup: (m) => {
      /** Red stays on for 30 seconds. */
      m.effect(red, {
        name: "redTimer",
        sends: [timeUp],
        fn: ({ clock, signal, emit }) => {
          clock.setTimeout(30_000, { signal, cb: () => emit(timeUp.create()) });
        },
      });
      /** Green stays on for 25 seconds. */
      m.effect(green, {
        name: "greenTimer",
        sends: [timeUp],
        fn: ({ clock, signal, emit }) => {
          clock.setTimeout(25_000, { signal, cb: () => emit(timeUp.create()) });
        },
      });
      /** Yellow stays on for 5 seconds. */
      m.effect(yellow, {
        name: "yellowTimer",
        sends: [timeUp],
        fn: ({ clock, signal, emit }) => {
          clock.setTimeout(5_000, { signal, cb: () => emit(timeUp.create()) });
        },
      });
      m.on(red, { event: timeUp, to: [green], handler: () => ({ state: green }) });
      m.on(green, { event: timeUp, to: [yellow], handler: () => ({ state: yellow }) });
      m.on(yellow, { event: timeUp, to: [red], handler: () => ({ state: red }) });
      m.onAny({ event: switchOff, to: [off], handler: () => ({ state: off }) });
    },
  });
}
