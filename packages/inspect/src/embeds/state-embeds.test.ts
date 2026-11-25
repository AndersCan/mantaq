import { describe, expect, test } from "vite-plus/test";
import { serializeViz, validateViz } from "@mantaq/viz";
import { delivery } from "../fixtures/embedded/delivery.ts";
import { Either } from "@mantaq/utils";
import { inspect } from "../inspect.ts";
import { toViz } from "../structure.ts";
import { VirtualClock } from "@mantaq/core";
import type { VizDocument } from "@mantaq/viz";

function references(document: VizDocument): Array<[string, string, string]> {
  const found: Array<[string, string, string]> = [];
  for (const machine of document.machines) {
    for (const state of machine.states) {
      if (state.machine !== undefined) found.push([machine.id, state.id, state.machine]);
    }
  }
  return found;
}

function validates(document: VizDocument): boolean {
  return Either.isRight(validateViz(JSON.parse(serializeViz(document))));
}

describe("embedded machines", () => {
  test("toViz adds the machine two states embed once, and both states name it", () => {
    const document = toViz([{ id: "delivery", actor: delivery.create({ clock: VirtualClock() }) }]);
    expect({
      machines: document.machines.map((machine) => machine.id),
      references: references(document),
      validates: validates(document),
    }).toEqual({
      machines: ["delivery", "scan"],
      references: [
        ["delivery", "handingOver", "scan"],
        ["delivery", "pickingUp", "scan"],
      ],
      validates: true,
    });
  });

  test("inspect fuzzes the embedded machine on its own, as if it were exported", () => {
    const inspected = inspect({ machine: delivery });
    const document: VizDocument = {
      schemaVersion: toViz([]).schemaVersion,
      machines: [inspected.machine, ...inspected.embedded],
    };
    const scan = inspected.embedded[0];
    const reached = (scan?.states ?? []).map((state) => [
      state.id,
      (state.coverage?.hits ?? 0) > 0,
    ]);
    expect({
      embedded: inspected.embedded.map((machine) => machine.id),
      references: references(document),
      fuzzed: scan?.fuzz !== null,
      reached,
      validates: validates(document),
    }).toEqual({
      embedded: ["scan"],
      references: [
        ["delivery", "handingOver", "scan"],
        ["delivery", "pickingUp", "scan"],
      ],
      fuzzed: true,
      reached: [
        ["reading", true],
        ["rejected", true],
        ["scanned", true],
      ],
      validates: true,
    });
  });
});
