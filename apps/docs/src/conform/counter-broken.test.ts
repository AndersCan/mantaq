import { assertMatchesModel } from "@mantaq/test";
import { expect, test } from "vite-plus/test";
import { createCounter } from "./counter-broken";
import { createCounterModel } from "./counter-model";
import failure from "./counter-broken.txt?raw";

test("a counter that passes its maximum fails with the printed sequence", async () => {
  await expect(
    assertMatchesModel({
      model: createCounterModel,
      start: () => createCounter(3),
      events: {
        increment: (app) => app.increment(),
        decrement: (app) => app.decrement(),
        reset: (app) => app.reset(),
      },
      state: (app) => (app.count === 0 ? "empty" : app.count >= 3 ? "full" : "counting"),
    }),
  ).rejects.toThrow(new Error(failure.trim()));
});
