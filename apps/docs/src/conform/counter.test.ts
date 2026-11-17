import { assertMatchesModel } from "@mantaq/test";
import { test } from "vite-plus/test";
import { createCounter } from "./counter";
import { counterModel } from "./counter-model";

test("the counter app matches its model", async () => {
  await assertMatchesModel({
    model: () => counterModel.create(),
    start: () => createCounter(3),
    events: {
      increment: (app) => app.increment(),
      decrement: (app) => app.decrement(),
      reset: (app) => app.reset(),
    },
    state: (app) => (app.count === 0 ? "empty" : app.count >= 3 ? "full" : "counting"),
  });
});
