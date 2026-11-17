import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { recordRuns } from "../record.ts";
import { timed } from "./timed.ts";

const make = recordRuns(timed);

test("times out", () => {
  const clock = VirtualClock();
  const actor = make.create({ clock });
  actor.send({ type: "start" });
  clock.advance(800);
  expect(actor.state.name).toBe("error");
});

test("waits", () => {
  const actor = make.create();
  actor.send({ type: "start" });
  expect(actor.state.name).toBe("waiting");
});
