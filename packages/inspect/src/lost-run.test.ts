// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { cookMachine } from "./fixtures/lost-dish.ts";
import { expectNoDesignErrors } from "./gate.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";

const file = join(import.meta.dirname, "fixtures/lost-dish.ts");

function failureOf(): string {
  try {
    expectNoDesignErrors({ machine: cookMachine });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

test("the check names the lost message's run on the line after its steps", () => {
  expect(failureOf()).toContain(
    "    after: DISH_COOKED\n    on the board: ?machine=cook&run=cook+sends+DISH_READY+to+waiter",
  );
});

test("the board's run opens by the printed name and ends on the lost message", async () => {
  const printed = /on the board: \?(.*)$/m.exec(failureOf())?.[1] ?? "";
  const query = new URLSearchParams(printed);
  const inspected = await inspectModule(file, { load: async () => ({ cookMachine }) });
  expect(inspected.machines.find((each) => each.id === query.get("machine"))).toBeDefined();
  history.replaceState(null, "", "?");
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: serializeViz(vizDocument(inspected.machines)),
    run: query.get("run") ?? "",
    targets: {
      cook: () => {
        const clock = VirtualClock();
        const made = cookMachine.create();
        return { actor: made.actor, clock, made };
      },
    },
  });
  expect(root.querySelector("[data-live-dropped]")?.textContent).toBe(
    "! cook sent DISH_READY to waiter: lost, nobody took it in serving",
  );
});
