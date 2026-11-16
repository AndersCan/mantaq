// @vitest-environment happy-dom
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mountViewer } from "@mantaq/viz/viewer";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { toViz } from "./structure.ts";

const idle = state("idle")();
const waiting = state("waiting")();
const timedOut = state("timedOut")();
const start = event("start")();
const expired = event("expired")();

const create = () => {
  const clock = VirtualClock();
  const actor = Actor({
    inputs: [start],
    internal: [expired],
    states: [idle, waiting, timedOut],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: start, to: [waiting], handler: () => ({ state: waiting }) });
      m.effect(waiting, {
        name: "deadline",
        sends: [expired],
        fn: (input) => withTimeout(30000, { input, event: () => expired.create() }),
      });
      m.on(waiting, { event: expired, to: [timedOut], handler: () => ({ state: timedOut }) });
    },
  });
  return { actor, clock };
};
const machine = toViz([{ id: "timed", ...create() }]).machines[0]!;
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");
const arrow = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const help = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-details-edge="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function mount(effectMode: "real" | "held") {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver: createDriver({ id: "timed", create }, { effectMode }) },
  );
  return root;
}

test("real withTimeout: line, then a click moves the walk", () => {
  const root = mount("real");
  const ids = machine.edges.map((e) => e.id);
  arrow(
    root,
    ids.find((id) => id.includes("start"))!,
  );
  expect(current(root)).toBe("waiting");
  const timerEdge = ids.find((id) => id.startsWith("waiting") && id.includes("expired"))!;
  help(root, timerEdge);
  expect(root.querySelector("[data-timer-line]")?.textContent).toBe(
    "expired fires on its own in 30000 ms; a click sends it now.",
  );
  arrow(root, timerEdge);
  expect(current(root)).toBe("timedOut");
});
