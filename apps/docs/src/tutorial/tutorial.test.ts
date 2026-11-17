import { describe, expect, test } from "vite-plus/test";
import { VirtualClock, event } from "@mantaq/core";
import { expectNoDesignErrors } from "@mantaq/inspect";
import { meal3 } from "./meal-03.ts";
import { meal4 } from "./meal-04.ts";
import { meal5 } from "./meal-05.ts";
import { meal6 } from "./meal-06.ts";
import { meal7 } from "./meal-07.ts";
import { meal8 } from "./meal-08.ts";
import { meal9 } from "./meal-09.ts";

const serve = event("serve")();
const eat = event("eat")<{ food: string }>();
const cook = event("cook")();
const drink = event("drink")();
const food = "soup";
const payloads = { eat: [{ food }, { food: "" }] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("tutorial machines", () => {
  test("step 3 makes the person full only when they eat something", () => {
    const actor = meal3.create();
    actor.send(eat.create({ food: "" }));
    expect(actor.state.name).toBe("hungry");
    actor.send(eat.create({ food }));
    expect(actor.state.name).toBe("full");
  });
  test("step 4 has no design errors", () => {
    expectNoDesignErrors({ machine: meal4, payloads });
  });
  test("step 5 has no design errors", () => {
    expectNoDesignErrors({ machine: meal5, payloads });
  });
  test("step 5 counts plates and stays hungry", () => {
    const actor = meal5.create();
    for (let n = 0; n < 3; n++) {
      actor.send(serve.create());
    }
    expect(actor.context.plates).toBe(3);
    expect(actor.state.name).toBe("hungry");
  });
  test("step 6 has no design errors", () => {
    expectNoDesignErrors({ machine: meal6, payloads });
  });
  test("step 7 has no design errors", () => {
    expectNoDesignErrors({ machine: meal7, payloads });
  });
  test("step 8 has no design errors", () => {
    expectNoDesignErrors({ machine: meal8, payloads });
  });
  test("step 9 has no design errors", () => {
    expectNoDesignErrors({ machine: meal9, payloads });
  });
  test("step 9 thirst region takes drink whatever the meal is doing", () => {
    const actor = meal9.create({ clock: VirtualClock() });
    expect(actor.state.name).toBe("hungry");
    actor.regions.thirst.send(drink.create());
    expect(actor.regions.thirst.state.name).toBe("quenched");
    expect(actor.state.name).toBe("hungry");
  });

  for (const [step, meal] of [
    ["6", meal6],
    ["7", meal7],
    ["8", meal8],
    ["9", meal9],
  ] as const) {
    test(`step ${step} refuses eat with no plates, then accepts it with a plate`, () => {
      const actor = meal.create({ clock: VirtualClock() });
      actor.send(eat.create({ food }));
      expect(actor.state.name).toBe("hungry");
      actor.send(serve.create());
      actor.send(eat.create({ food }));
      expect(actor.state.name).toBe("full");
    });
  }

  for (const [step, meal] of [
    ["7", meal7],
    ["8", meal8],
    ["9", meal9],
  ] as const) {
    test(`step ${step} cooking puts a plate on the table`, async () => {
      const actor = meal.create({ clock: VirtualClock() });
      actor.send(cook.create());
      expect(actor.state.name).toBe("cooking");
      await flush();
      expect(actor.state.name).toBe("hungry");
      expect(actor.context.plates).toBe(1);
    });
  }

  for (const [step, meal] of [
    ["8", meal8],
    ["9", meal9],
  ] as const) {
    test(`step ${step} the food burns at 10 seconds`, () => {
      const clock = VirtualClock();
      const actor = meal.create({ clock });
      actor.send(cook.create());
      clock.advance(9_999);
      expect(actor.state.name).toBe("cooking");
      clock.advance(1);
      expect(actor.state.name).toBe("hungry");
      expect(actor.context.plates).toBe(0);
    });
    test(`step ${step} leaving cooking cancels the timer`, async () => {
      const clock = VirtualClock();
      const actor = meal.create({ clock });
      actor.send(cook.create());
      await flush();
      expect(actor.state.name).toBe("hungry");
      expect(actor.context.plates).toBe(1);
      clock.advance(5_000);
      actor.send(cook.create());
      clock.advance(5_000);
      expect(actor.state.name).toBe("cooking");
      clock.advance(5_000);
      expect(actor.state.name).toBe("hungry");
      expect(actor.context.plates).toBe(1);
    });
  }
});
