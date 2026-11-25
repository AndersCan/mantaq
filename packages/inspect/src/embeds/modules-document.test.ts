import { describe, expect, test } from "vite-plus/test";
import { delivery } from "../fixtures/embedded/delivery.ts";
import { modulesDocument } from "./modules-document.ts";
import { scan } from "../fixtures/embedded/scan.ts";
import { toViz } from "../structure.ts";
import { VirtualClock } from "@mantaq/core";

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
    expect(modulesDocument(files).machines).toEqual([...parents, ...children]);
  });

  test("an embedded copy gives way to the machine a file exports", () => {
    const exported = children.map((machine) => ({ ...machine, runs: [] }));
    const files = [
      { machines: parents, embedded: children },
      { machines: exported, embedded: [] },
    ];
    const shown = modulesDocument(files).machines;
    expect(shown.length === 2 && shown[1] === exported[0]).toBe(true);
  });
});
