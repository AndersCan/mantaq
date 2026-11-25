import { describe, expect, test } from "vite-plus/test";
import { delivery } from "../fixtures/embedded/delivery.ts";
import { machineWithEmbeds } from "./machine-with-embeds.ts";
import { retry } from "../fixtures/retry.ts";
import { toViz } from "../structure.ts";
import { VirtualClock } from "@mantaq/core";

describe("machineWithEmbeds", () => {
  const document = toViz([
    { id: "delivery", actor: delivery.create({ clock: VirtualClock() }) },
    { id: "retry", actor: retry.create({ clock: VirtualClock() }) },
  ]);

  function cut(id: string): string[] {
    const chosen = document.machines.find((machine) => machine.id === id);
    if (chosen === undefined) return [];
    return machineWithEmbeds(document, { machine: chosen }).map((machine) => machine.id);
  }

  test("keeps the machines the chosen one embeds and leaves the others out", () => {
    expect({ delivery: cut("delivery"), retry: cut("retry"), scan: cut("scan") }).toEqual({
      delivery: ["delivery", "scan"],
      retry: ["retry"],
      scan: ["scan"],
    });
  });

  test("follows embeds two levels down", () => {
    const chain = [];
    for (const [id, target] of [
      ["order", "payment"],
      ["payment", "receipt"],
      ["receipt", undefined],
    ]) {
      const base = document.machines[0];
      if (base === undefined || id === undefined) continue;
      const states = base.states.map((state) => {
        const copy = { ...state };
        delete copy.machine;
        return target === undefined ? copy : { ...copy, machine: target };
      });
      chain.push({ ...base, id, states });
    }
    const chosen = chain[0];
    const kept =
      chosen === undefined
        ? []
        : machineWithEmbeds({ ...document, machines: chain }, { machine: chosen });
    expect(kept.map((machine) => machine.id)).toEqual(["order", "payment", "receipt"]);
  });
});
