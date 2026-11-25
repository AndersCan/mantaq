// @vitest-environment happy-dom
import { Actor, event, state, VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { failureLines, sweep } from "./sweep.ts";
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

/** A button whose click throws before it changes anything. */
function throwingButton(root: HTMLElement): void {
  const button = root.ownerDocument.createElement("button");
  button.textContent = "Send";
  button.addEventListener("click", () => {
    throw new Error("no driver for this");
  });
  root.querySelector(".panel")?.append(button);
}

/** States that show as buttons in a diagram-only viewer, where a click only outlines them: no panel shows what was selected. */
function everyStateAButton(root: HTMLElement): void {
  if (!root.classList.contains("diagram-only")) return;
  for (const node of root.querySelectorAll(".graph g.state")) {
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
  }
}

/** A tab stop with no handler: it looks clickable to the keyboard and does nothing. */
function deadTabStop(root: HTMLElement): void {
  const stop = root.ownerDocument.createElement("span");
  stop.setAttribute("tabindex", "0");
  stop.textContent = "Focus me";
  root.querySelector(".panel")?.append(stop);
}

test("the viewer as it is has no dead element", async () => {
  expect(failureLines(await sweep(plain))).toEqual([]);
});

test("an arrow that shows as a button but sends nothing is reported with its walk", async () => {
  const report = await sweep(plain, { afterMount: everyArrowAButton });
  expect(failureLines(report)).toEqual([
    'plain: walk [], no driver, with panel, focus []: g.edge[data-edge-id="idle-start-busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, with panel, focus []: g.edge[data-edge-id="idle-start-busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], no driver, diagram only, focus []: g.edge[data-edge-id="idle-start-busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, diagram only, focus []: g.edge[data-edge-id="idle-start-busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
  ]);
});

test("a button that does nothing is reported", async () => {
  const report = await sweep(plain, { afterMount: deadButton });
  expect(failureLines(report)).toEqual([
    'plain: walk [], no driver, with panel, focus []: button "Open" changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], driver, with panel, focus []: button "Open" changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, with panel, focus []: button "Open" changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
  ]);
});

test("a button whose click throws is reported, with the error", async () => {
  const report = await sweep(plain, { afterMount: throwingButton });
  expect(failureLines(report)).toEqual([
    'plain: walk [], no driver, with panel, focus []: button "Send" throws: no driver for this. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], no driver, with panel, focus []: button "Send" changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], driver, with panel, focus []: button "Send" throws: no driver for this. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], driver, with panel, focus []: button "Send" changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, with panel, focus []: button "Send" throws: no driver for this. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, with panel, focus []: button "Send" changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
  ]);
});

test("a walk that does not replay is reported", async () => {
  const report = await sweep({ ...plain, walks: [["start", "nope=[1"]] });
  expect(failureLines(report)).toEqual([
    "plain: walk [start, nope=[1], driver, with panel, focus []: the walk replays only 1 of 2 steps. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).",
    "plain: walk [start, nope=[1], driver, diagram only, focus []: the walk replays only 1 of 2 steps. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).",
  ]);
});

test("a state that only gets outlined, with no panel to open, is reported", async () => {
  const report = await sweep(plain, { afterMount: everyStateAButton });
  expect(failureLines(report)).toEqual([
    'plain: walk [], no driver, diagram only, focus []: g.state[data-node-id="busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], no driver, diagram only, focus []: g.state.initial[data-node-id="idle"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], driver, diagram only, focus []: g.state[data-node-id="busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [], driver, diagram only, focus []: g.state.initial.current[data-node-id="idle"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, diagram only, focus []: g.state.current[data-node-id="busy"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
    'plain: walk [start], driver, diagram only, focus []: g.state.initial[data-node-id="idle"] changes nothing. Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).',
  ]);
});

test("a tab stop that does nothing is reported", async () => {
  const report = await sweep(plain, { afterMount: deadTabStop });
  const fix = "Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).";
  expect(failureLines(report)).toEqual([
    `plain: walk [], no driver, with panel, focus []: span "Focus me" changes nothing. ${fix}`,
    `plain: walk [], driver, with panel, focus []: span "Focus me" changes nothing. ${fix}`,
    `plain: walk [start], driver, with panel, focus []: span "Focus me" changes nothing. ${fix}`,
  ]);
});

/** A button that marks itself picked: the first click shows it, a second changes nothing. */
function pickOnce(root: HTMLElement): void {
  const button = root.ownerDocument.createElement("button");
  button.textContent = "Pick";
  button.addEventListener("click", () => button.classList.add("picked"));
  root.querySelector(".panel")?.append(button);
}

/** A button that opens a box whose close button does nothing. */
function deadClose(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const open = doc.createElement("button");
  open.textContent = "Open";
  open.addEventListener("click", () => {
    const close = doc.createElement("button");
    close.textContent = "Close";
    open.after(close);
    open.remove();
  });
  root.querySelector(".panel")?.append(open);
}

test("an element whose second click changes nothing is reported", async () => {
  const report = await sweep(plain, { afterMount: pickOnce });
  const fix = "Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).";
  expect(failureLines(report)).toEqual([
    `plain: walk [], no driver, with panel, focus []: button "Pick" changes nothing on a second click. ${fix}`,
    `plain: walk [], driver, with panel, focus []: button "Pick" changes nothing on a second click. ${fix}`,
    `plain: walk [start], driver, with panel, focus []: button "Pick" changes nothing on a second click. ${fix}`,
  ]);
});

test("a dead element that a click brings is reported with that click", async () => {
  const report = await sweep(plain, { afterMount: deadClose });
  const fix = "Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).";
  expect(failureLines(report)).toEqual([
    `plain: walk [], no driver, with panel, focus [], after a click on button "Open": button "Close" changes nothing. ${fix}`,
    `plain: walk [], driver, with panel, focus [], after a click on button "Open": button "Close" changes nothing. ${fix}`,
    `plain: walk [start], driver, with panel, focus [], after a click on button "Open": button "Close" changes nothing. ${fix}`,
  ]);
});
