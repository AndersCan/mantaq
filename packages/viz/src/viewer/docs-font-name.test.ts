import { describe, expect, test } from "vite-plus/test";
import type { VizMachine, VizState } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import { LABEL_PAD } from "./geometry.ts";
import { placeMachine } from "./layout.ts";

/** IBM Plex Sans Variable at 12px (docs home), Chromium getBBox of the name: top 12.5 above the baseline, 16.25 tall. */
const DOCS_ASCENT = 12.5;
const DOCS_GLYPH_HEIGHT = 16.25;

function state(id: string, effects: string[]): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: id === "basicInfo",
    final: false,
    effects: effects.map((name) => ({ name, sends: [] })),
    coverage: null,
    tested: null,
    doc: null,
  };
}

describe("checkout `submitting` (one chargeCard chip) in the docs font", () => {
  test("the drawn name keeps LABEL_PAD from the box top and from its chip", () => {
    const machine = {
      version: VIZ_SCHEMA_VERSION,
      initial: "basicInfo",
      states: [state("basicInfo", []), state("submitting", ["chargeCard"])],
      edges: [],
      events: [],
      maps: [],
      regions: [],
    } as unknown as VizMachine;
    const placed = placeMachine(machine).nodes.find((each) => each.id === "submitting");
    if (placed?.kind !== "state") throw new Error("not a state");
    const glyphTop = placed.label.y + 4 - DOCS_ASCENT; // graph.ts draws the baseline at label.y + 4
    const glyphBottom = glyphTop + DOCS_GLYPH_HEIGHT;
    const chip = placed.chips[0];
    if (chip === undefined) throw new Error("no chip");
    expect(glyphTop - (placed.y - placed.height / 2)).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(chip.y - chip.height / 2 - glyphBottom).toBeGreaterThanOrEqual(LABEL_PAD);
  });
});
