import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { cook, createMeal9 } from "./meal-09";

test("food left on the stove for 10 seconds burns, and the person is hungry again", () => {
  const clock = VirtualClock();
  const meal = createMeal9(clock);

  meal.send(cook.create());
  expect(meal.state.name).toBe("cooking");

  clock.advance(9_999);
  expect(meal.state.name).toBe("cooking");
  clock.advance(1);
  expect(meal.state.name).toBe("hungry");
  expect(meal.context.plates).toBe(0);
});
