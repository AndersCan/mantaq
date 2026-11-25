import { describe, expect, test } from "vite-plus/test";
import { validateViz, VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { delivery } from "../fixtures/embedded/delivery.ts";
import { Either } from "@mantaq/utils";
import { modulesDocument } from "./modules-document.ts";
import { scan } from "../fixtures/embedded/scan.ts";
import { toViz } from "../structure.ts";
import { VirtualClock } from "@mantaq/core";
import type { VizMachine } from "@mantaq/viz";

describe("modulesDocument", () => {
  const drawn = toViz([
    { id: "delivery", actor: delivery.create({ clock: VirtualClock() }) },
    { id: "scan", actor: scan.create({ clock: VirtualClock() }) },
  ]).machines;
  const parents = drawn.filter((machine) => machine.id === "delivery");
  const children = drawn.filter((machine) => machine.id === "scan");

  test("puts each file's machines first and an embedded machine once, after them", () => {
    const files = [
      { machines: parents, embedded: children },
      { machines: [], embedded: children },
    ];
    expect(modulesDocument(files)).toEqual({
      document: { schemaVersion: VIZ_SCHEMA_VERSION, machines: [...parents, ...children] },
      warnings: [],
    });
  });

  test("an embedded copy gives way to the machine a file exports", () => {
    const exported = children.map((machine) => ({ ...machine, runs: [] }));
    const files = [
      { machines: parents, embedded: children },
      { machines: exported, embedded: [] },
    ];
    const shown = modulesDocument(files).document.machines;
    expect(shown.length === 2 && shown[1] === exported[0]).toBe(true);
  });

  test("a cycle through the machines of two files is broken, so the document validates", () => {
    interface Embeds {
      target: string;
    }
    function embedding(id: string, options: Embeds): VizMachine[] {
      return parents.map((machine) => ({
        ...machine,
        id,
        states: machine.states.map((state) => ({ ...state, machine: options.target })),
      }));
    }
    const first = { machines: embedding("order", { target: "payment" }), embedded: [] };
    const second = { machines: embedding("payment", { target: "order" }), embedded: [] };
    const merged = modulesDocument([first, second]);
    const references = merged.document.machines.map((machine) => [
      machine.id,
      [...new Set(machine.states.map((state) => state.machine))],
    ]);
    expect({
      references,
      validates: Either.isRight(validateViz(JSON.parse(JSON.stringify(merged.document)))),
      warnings: merged.warnings.length,
    }).toEqual({
      references: [
        ["order", ["payment"]],
        ["payment", [undefined]],
      ],
      validates: true,
      warnings: parents[0]?.states.length,
    });
  });
});
