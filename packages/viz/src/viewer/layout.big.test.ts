import { describe, expect, test } from "vite-plus/test";
import { isDrawn, layoutMachine } from "./layout.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { Either } from "@mantaq/utils";
import { partMachine } from "./parts.ts";
import { validateViz } from "../validate.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import whole from "./reference/justus-whole-app.json" with { type: "json" };

const STATES = 21;
const ARROWS = 100;
/** The viewer lays out again on every click. */
const BUDGET_MS = 1000;

function foldersPart(): VizMachine {
  const read = validateViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [whole] });
  const app = Either.isRight(read) ? read[1].machines[0] : undefined;
  if (app === undefined) throw new Error("the whole-app reference does not validate");
  return partMachine(app, "folders");
}

function copiedState(state: VizState): VizState {
  const id = `${state.id}Again`;
  return { ...state, id, label: id, initial: false };
}

interface ArrowEnds {
  from: string;
  target: string;
  index: number;
}

function copiedArrow(arrow: VizEdge, ends: ArrowEnds): VizEdge {
  const event = `${arrow.event}_AGAIN_${ends.index}`;
  const target = arrow.kind === "stay" ? ends.from : ends.target;
  return { ...arrow, id: `${ends.from}-${event}-${target}`, from: ends.from, event, to: target };
}

/** The folders part of the whole-app reference, grown to 21 states and 100 arrows by copying its own states and arrows. */
function bigMachine(): VizMachine {
  const part = foldersPart();
  const states = [...part.states];
  for (const state of part.states.slice(0, STATES - part.states.length)) {
    states.push(copiedState(state));
  }
  const arrows = part.edges.filter((edge) => edge.kind === "transition" || edge.kind === "stay");
  const edges = [...part.edges];
  for (let index = 0; edges.filter(isDrawn).length < ARROWS; index++) {
    const template = arrows[index % arrows.length];
    const from = states[(index * 7) % states.length]?.id;
    const target = states[(index * 11 + 3) % states.length]?.id;
    if (template === undefined || from === undefined || target === undefined) break;
    edges.push(copiedArrow(template, { from, target, index }));
  }
  return { ...part, id: "folders-big", states, edges };
}

describe("a big machine (21 states, 100 arrows)", () => {
  const machine = bigMachine();

  test("is that big", () => {
    expect([machine.states.length, machine.edges.filter(isDrawn).length]).toEqual([STATES, ARROWS]);
  });

  test("lays out again, as on a click, and is checked for overlaps within the budget", () => {
    layoutMachine(machine);
    const started = performance.now();
    const laid = layoutMachine(machine);
    const took = performance.now() - started;
    expect(Either.isRight(laid)).toBe(true);
    expect(took).toBeLessThan(BUDGET_MS);
  }, 30_000);
});
