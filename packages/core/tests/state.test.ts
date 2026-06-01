import { expect, test } from "vite-plus/test";
import { state } from "../src/state.ts";

test("state", () => {
  const myState = state("myState")();
  expect(myState.name).toBe("myState");

  myState.region({
    initial: "start",
    states: {
      start: state("start")(),
      end: state("end")().final(),
    },
  });

  myState.regions({
    foo: {
      initial: "start",
      states: {
        start: state("start")(),
        end: state("end")().final(),
      },
    },
    bar: {
      initial: "start",
      states: {
        start: state("start")(),
        end: state("end")().final(),
      },
    },
  });
});
