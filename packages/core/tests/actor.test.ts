import { expect, test } from "vite-plus/test";
import { Actor } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

test("actor", () => {
  // Input events
  const toggle = event("toggled")();
  const powerOff = event("powerOff")();
  // const bad = event("bad")();
  // Output events
  const stateChanged = event("stateChanged")<"on" | "off">();
  const isOff = event("isOff")();

  // States
  const off = state("off")<{ offCounter: number }>();
  const on = state("on")<{ onCounter: number }>().effect((options) => {
    // Correct slice
    console.log(options.context.onCounter++);
    //@ts-expect-error this should fail
    console.log(options.context.offCounter++);
  });

  // Actor
  const light = new Actor({
    inputs: [toggle, powerOff],
    outputs: [stateChanged, isOff],
    context: {
      offCounter: 0,
      onCounter: 0,
    },
    states: [on, off],
    initial: off,
    transitions: {
      off: {
        toggled: () => ({ next: on }),
      },
      on: {
        toggled: (e) => ({ next: off, e }),
        powerOff: () => ({ next: off, emit: [stateChanged] }),
      },
    },
  });
  expect(light.state).toEqual(off);
  light.send(toggle);
  expect(light.state).toEqual(on);
});
