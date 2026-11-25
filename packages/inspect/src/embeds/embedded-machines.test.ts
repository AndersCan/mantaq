import { Actor, machine as defineMachine, state as defineState } from "@mantaq/core";
import type { BuiltEmbedding, Embedding } from "./embedded-machines.ts";
import { describe, expect, test } from "vite-plus/test";
import { EMBED_DEPTH, withEmbedded } from "./embedded-machines.ts";
import type { VizMachine, VizState } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import type { Machine } from "@mantaq/core";
import { toVizMachine } from "../structure.ts";

interface Shape {
  /** Machine id per state id; a state with no machine is a plain state. */
  states: Readonly<Record<string, string | undefined>>;
}

function oneStateActor(): ReturnType<typeof Actor> {
  const only = defineState("only")();
  return Actor({ inputs: [], states: [only], initial: only, setup: () => undefined });
}

function machineRef(id: string): Machine {
  return defineMachine(id, { create: () => oneStateActor() });
}

function drawnMachine(id: string, shape: Shape): VizMachine {
  const template = toVizMachine({ id, actor: oneStateActor() });
  const plain = template.states[0];
  const states: VizState[] = [];
  for (const [state, machine] of Object.entries(shape.states)) {
    if (plain === undefined) continue;
    states.push({
      ...plain,
      ...(machine === undefined ? {} : { machine }),
      id: state,
      label: state,
    });
  }
  return { ...template, states };
}

function embedding(id: string, shape: Shape): BuiltEmbedding {
  const embeds = [];
  for (const [state, machine] of Object.entries(shape.states)) {
    if (machine !== undefined) embeds.push({ state, machine: machineRef(machine) });
  }
  return { machine: drawnMachine(id, shape), embeds, warnings: [] };
}

interface Catalog {
  shapes: Readonly<Record<string, Shape>>;
  built: string[];
}

/** A build that draws each machine from its shape and notes the ids it built. */
function buildFrom(catalog: Catalog): (machine: Machine) => Either<string, BuiltEmbedding> {
  return (machine) => {
    catalog.built.push(machine.id);
    const shape = catalog.shapes[machine.id];
    if (shape === undefined) return Either.left("create() threw");
    return Either.right(embedding(machine.id, shape));
  };
}

function ids(machines: ReadonlyArray<VizMachine>): string[] {
  return machines.map((machine) => machine.id);
}

function references(machine: VizMachine | undefined): Array<string | undefined> {
  return (machine?.states ?? []).map((state) => state.machine);
}

describe("withEmbedded", () => {
  test("a machine embedded in two states is built once and both states keep the reference", () => {
    const catalog: Catalog = { shapes: { scan: { states: { reading: undefined } } }, built: [] };
    const root: Embedding = embedding("delivery", {
      states: { pickingUp: "scan", onTheWay: undefined, handingOver: "scan" },
    });
    const drawn = withEmbedded([root], { build: buildFrom(catalog) });
    expect({
      roots: drawn.roots,
      embedded: ids(drawn.embedded),
      built: catalog.built,
      warnings: drawn.warnings,
    }).toEqual({ roots: [root.machine], embedded: ["scan"], built: ["scan"], warnings: [] });
  });

  test("a root that another root embeds is not built again", () => {
    const catalog: Catalog = { shapes: {}, built: [] };
    const parent = embedding("delivery", { states: { pickingUp: "scan" } });
    const child = embedding("scan", { states: { reading: undefined } });
    const drawn = withEmbedded([parent, child], { build: buildFrom(catalog) });
    expect({
      roots: ids(drawn.roots),
      embedded: drawn.embedded,
      built: catalog.built,
      reference: references(drawn.roots[0]),
    }).toEqual({ roots: ["delivery", "scan"], embedded: [], built: [], reference: ["scan"] });
  });

  test("a reference that closes a cycle is dropped, the others stay", () => {
    const catalog: Catalog = {
      shapes: {
        payment: { states: { charging: "order", refunding: "receipt" } },
        receipt: { states: { printing: undefined } },
      },
      built: [],
    };
    const drawn = withEmbedded([embedding("order", { states: { paying: "payment" } })], {
      build: buildFrom(catalog),
    });
    expect({
      root: references(drawn.roots[0]),
      embedded: drawn.embedded.map((machine) => [machine.id, references(machine)]),
      warnings: drawn.warnings,
    }).toEqual({
      root: ["payment"],
      embedded: [
        ["payment", [undefined, "receipt"]],
        ["receipt", [undefined]],
      ],
      warnings: [
        "payment: charging embeds order, not drawn: that is a cycle: order embeds this machine, directly or through others",
      ],
    });
  });

  test("a chain deeper than the depth cap stops with a warning", () => {
    const shapes: Record<string, Shape> = {};
    for (let level = 1; level <= EMBED_DEPTH + 1; level += 1) {
      const next = level + 1;
      shapes[`level${level}`] = { states: { inside: `level${next}` } };
    }
    const tooDeep = EMBED_DEPTH + 1;
    const catalog: Catalog = { shapes, built: [] };
    const drawn = withEmbedded([embedding("level0", { states: { inside: "level1" } })], {
      build: buildFrom(catalog),
    });
    const deepest = drawn.embedded.at(-1);
    expect({
      count: drawn.embedded.length,
      deepest: deepest?.id,
      reference: references(deepest),
      warnings: drawn.warnings,
    }).toEqual({
      count: EMBED_DEPTH,
      deepest: `level${EMBED_DEPTH}`,
      reference: [undefined],
      warnings: [
        `level${EMBED_DEPTH}: inside embeds level${tooDeep}, not drawn: it is more than ${EMBED_DEPTH} machines deep`,
      ],
    });
  });

  test("a machine that cannot be built is tried once and each reference to it is dropped", () => {
    const catalog: Catalog = { shapes: {}, built: [] };
    const root = embedding("delivery", { states: { pickingUp: "scan", handingOver: "scan" } });
    const drawn = withEmbedded([root], { build: buildFrom(catalog) });
    expect({
      reference: references(drawn.roots[0]),
      built: catalog.built,
      warnings: drawn.warnings,
    }).toEqual({
      reference: [undefined, undefined],
      built: ["scan"],
      warnings: [
        "delivery: pickingUp embeds scan, not drawn: it could not be built: create() threw",
        "delivery: handingOver embeds scan, not drawn: it could not be built: create() threw",
      ],
    });
  });

  test("a state with two embeds names the first and warns about the second", () => {
    const catalog: Catalog = {
      shapes: {
        scan: { states: { reading: undefined } },
        weigh: { states: { weighing: undefined } },
      },
      built: [],
    };
    const root: Embedding = {
      machine: drawnMachine("delivery", { states: { pickingUp: "scan" } }),
      embeds: [
        { state: "pickingUp", machine: machineRef("scan") },
        { state: "pickingUp", machine: machineRef("weigh") },
      ],
    };
    const drawn = withEmbedded([root], { build: buildFrom(catalog) });
    expect({ embedded: ids(drawn.embedded), warnings: drawn.warnings }).toEqual({
      embedded: ["scan"],
      warnings: ["delivery: pickingUp embeds scan and weigh; the diagram shows only scan"],
    });
  });
});
