// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { cookMachine } from "../../../apps/docs/src/design/dropped-message.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";
import { sendVia } from "./send-via.ts";

const file = join(import.meta.dirname, "../../../apps/docs/src/design/dropped-message.ts");

test("the design page's lost dish is one row: nobody else is said to have sent it", async () => {
  const inspected = await inspectModule(file, { load: async () => ({ cookMachine }), fuzz: false });
  history.replaceState(null, "", "?");
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: serializeViz(vizDocument(inspected.machines)),
    targets: {
      cook: () => {
        const clock = VirtualClock();
        const made = cookMachine.create();
        return { actor: made.actor, clock, made };
      },
    },
  });
  sendVia(root, "BREAK_STARTED");
  sendVia(root, "DISH_COOKED");
  const step = root.querySelector('[data-step="2"]');
  expect(step?.querySelector("[data-live-dropped]")?.textContent).toBe(
    "! 1. cook sent DISH_READY to waiter: lost, nobody took it in onBreak",
  );
  expect(step?.querySelectorAll("[data-live-sent]")).toHaveLength(0);
});
