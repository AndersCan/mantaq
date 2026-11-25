// @vitest-environment happy-dom
import { Actor, event, state, VirtualClock } from "@mantaq/core";
import { deadLines, sweep } from "./sweep.ts";
import { expect, test } from "vite-plus/test";
import type { SweepCase } from "./sweep.ts";
import { toViz } from "../structure.ts";

const idle = state("idle")();
const busy = state("busy")();
const start = event("start")();

function create() {
  const clock = VirtualClock();
  const actor = Actor({
    inputs: [start],
    states: [idle, busy],
    initial: idle,
    clock,
    setup: (machine) => {
      machine.on(idle, { event: start, to: [busy], handler: () => ({ state: busy }) });
    },
  });
  return { actor, clock };
}

const target = { id: "plain", create };
const plain: SweepCase = {
  name: "plain",
  viz: toViz([{ id: "plain", ...create() }]),
  target,
  walks: [["start"]],
};

/** The shape of the dead arrows the embedded machines shipped: every arrow shows as a button, whether a click sends it or not. */
function everyArrowAButton(root: HTMLElement): void {
  for (const arrow of root.querySelectorAll(".graph g.edge[data-edge-id]")) {
    arrow.setAttribute("role", "button");
    arrow.setAttribute("tabindex", "0");
  }
}

function deadButton(root: HTMLElement): void {
  const button = root.ownerDocument.createElement("button");
  button.textContent = "Open";
  root.querySelector(".panel")?.append(button);
}

test("the viewer as it is has no dead element", async () => {
  expect(deadLines(await sweep(plain))).toEqual([]);
});

test("an arrow that shows as a button but sends nothing is reported with its walk", async () => {
  const report = await sweep(plain, { afterMount: everyArrowAButton });
  expect(deadLines(report)).toEqual([
    'plain: walk [], no driver, with panel, focus []: g.edge[data-edge-id="idle-start-busy"]',
    'plain: walk [start], driver, with panel, focus []: g.edge[data-edge-id="idle-start-busy"]',
    'plain: walk [], no driver, diagram only, focus []: g.edge[data-edge-id="idle-start-busy"]',
    'plain: walk [start], driver, diagram only, focus []: g.edge[data-edge-id="idle-start-busy"]',
  ]);
});

test("a button that does nothing is reported", async () => {
  const report = await sweep(plain, { afterMount: deadButton });
  expect(deadLines(report)).toEqual([
    'plain: walk [], no driver, with panel, focus []: button "Open"',
    'plain: walk [], driver, with panel, focus []: button "Open"',
    'plain: walk [start], driver, with panel, focus []: button "Open"',
  ]);
});
