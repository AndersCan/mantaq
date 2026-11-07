// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mountViewer } from "@mantaq/viz/viewer";
import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
import { inspect } from "./inspect.ts";

const create = () => {
  const clock = VirtualClock();
  return { actor: createThrowingActor(clock), clock };
};

test("clicking the mark on a throwing state and Replay shows the thrown message", () => {
  const { machine } = inspect({ id: "throwing", create: () => create().actor });
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "throwing", create }) },
  );
  root
    .querySelector('[data-node-id="idle"] .finding-mark')
    ?.dispatchEvent(new Event("click", { bubbles: true }));
  root.querySelector<HTMLButtonElement>("[data-replay]")?.click();
  expect(root.querySelector("[data-live-error]")?.textContent).toContain("TypeError");
});
