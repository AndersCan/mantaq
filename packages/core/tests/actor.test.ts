import { expect, test } from "vite-plus/test";
import { Actor } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

test("actor", () => {
  // Events
  const toggle = event("toggled")();
  const powerOff = event("powerOff")();
  const stateChanged = event("stateChanged")<"on" | "off">();
  const isOff = event("isOff")();

  // States
  const off = state("off");
  const on = state("on");

  // Actor
  const light = new Actor({
    inputs: [toggle, powerOff],
    outputs: [stateChanged, isOff],
    states: [on, off],
    initial: off,
    transitions: {
      off: {
        toggled: () => ({ next: on }),
      },
      on: {
        toggled: () => ({ next: off }),
        powerOff: () => ({ next: off, emit: [stateChanged] }),
      },
    },
  });
  expect(light.state).toEqual(off);
  light.send(toggle);
  expect(light.state).toEqual(on);
});
