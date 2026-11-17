import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { cook, meal9 } from "./meal-09";

test("food left on the stove for 10 seconds burns, and the person is hungry again", () => {
  const clock = VirtualClock();
  const actor = meal9.create({ clock });

  actor.send(cook.create());
  expect(actor.state.name).toBe("cooking");

  clock.advance(9_999);
  expect(actor.state.name).toBe("cooking");
  clock.advance(1);
  expect(actor.state.name).toBe("hungry");
  expect(actor.context.plates).toBe(0);
});
