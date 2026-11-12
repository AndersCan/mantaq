import { describe, expect, test } from "vite-plus/test";
import { VirtualClock, event } from "@mantaq/core";
import { expectNoDesignErrors } from "@mantaq/inspect";
import { createMeal3 } from "./meal-03.ts";
import { createMeal4 } from "./meal-04.ts";
import { createMeal5 } from "./meal-05.ts";
import { createMeal6 } from "./meal-06.ts";
import { createMeal7 } from "./meal-07.ts";
import { createMeal8 } from "./meal-08.ts";
import { createMeal9 } from "./meal-09.ts";

const serve = event("serve")();
const eat = event("eat")<{ food: string }>();
const cook = event("cook")();
const drink = event("drink")();
const food = "soup";
const payloads = { eat: [{ food }, { food: "" }] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("tutorial machines", () => {
  test("step 3 makes the person full only when they eat something", () => {
    const actor = createMeal3();
    actor.send(eat.create({ food: "" }));
    expect(actor.state.name).toBe("hungry");
    actor.send(eat.create({ food }));
    expect(actor.state.name).toBe("full");
  });
  test("step 4 has no design errors", () => {
    expectNoDesignErrors({ id: "meal4", create: createMeal4, payloads });
  });
  test("step 5 has no design errors", () => {
    expectNoDesignErrors({ id: "meal5", create: createMeal5, payloads });
  });
  test("step 5 counts plates and stays hungry", () => {
    const actor = createMeal5();
    for (let n = 0; n < 3; n++) {
      actor.send(serve.create());
    }
    expect(actor.context.plates).toBe(3);
    expect(actor.state.name).toBe("hungry");
  });
  test("step 6 has no design errors", () => {
    expectNoDesignErrors({ id: "meal6", create: () => createMeal6(VirtualClock()), payloads });
  });
  test("step 7 has no design errors", () => {
    expectNoDesignErrors({ id: "meal7", create: () => createMeal7(VirtualClock()), payloads });
  });
  test("step 8 has no design errors", () => {
    expectNoDesignErrors({ id: "meal8", create: () => createMeal8(VirtualClock()), payloads });
  });
  test("step 9 has no design errors", () => {
    expectNoDesignErrors({ id: "meal9", create: () => createMeal9(VirtualClock()), payloads });
  });
  test("step 9 thirst region takes drink whatever the meal is doing", () => {
    const actor = createMeal9(VirtualClock());
    expect(actor.state.name).toBe("hungry");
    actor.regions.thirst.send(drink.create());
    expect(actor.regions.thirst.state.name).toBe("quenched");
    expect(actor.state.name).toBe("hungry");
  });

  for (const [step, create] of [
    ["6", createMeal6],
    ["7", createMeal7],
    ["8", createMeal8],
    ["9", createMeal9],
  ] as const) {
    test(`step ${step} refuses eat with no plates, then accepts it with a plate`, () => {
      const actor = create(VirtualClock());
      actor.send(eat.create({ food }));
      expect(actor.state.name).toBe("hungry");
      actor.send(serve.create());
      actor.send(eat.create({ food }));
      expect(actor.state.name).toBe("full");
    });
  }

  for (const [step, create] of [
    ["7", createMeal7],
    ["8", createMeal8],
    ["9", createMeal9],
  ] as const) {
    test(`step ${step} cooking puts a plate on the table`, async () => {
      const actor = create(VirtualClock());
      actor.send(cook.create());
      expect(actor.state.name).toBe("cooking");
      await flush();
      expect(actor.state.name).toBe("hungry");
      expect(actor.context.plates).toBe(1);
    });
  }

  for (const [step, create] of [
    ["8", createMeal8],
    ["9", createMeal9],
  ] as const) {
    test(`step ${step} the food burns at 10 seconds`, () => {
      const clock = VirtualClock();
      const actor = create(clock);
      actor.send(cook.create());
      clock.advance(9_999);
      expect(actor.state.name).toBe("cooking");
      clock.advance(1);
      expect(actor.state.name).toBe("hungry");
      expect(actor.context.plates).toBe(0);
    });
    test(`step ${step} leaving cooking cancels the timer`, async () => {
      const clock = VirtualClock();
      const actor = create(clock);
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
