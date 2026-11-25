import type { VizEdge, VizMachine, VizState } from "../../schema.ts";
import { scopeOf } from "../../schema.ts";

interface StateShape {
  group?: string;
  initial?: boolean;
  final?: boolean;
  hits?: number;
  effects?: string[];
}

/** A test state: its region is its scope. */
export function stateOf(id: string, shape: StateShape = {}): VizState {
  const scope = scopeOf(id);
  const state: VizState = {
    id,
    label: id,
    region: scope === "" ? null : scope,
    initial: shape.initial ?? false,
    final: shape.final ?? false,
    effects: (shape.effects ?? []).map((name) => ({ name, sends: [] })),
    coverage: shape.hits === undefined ? null : { hits: shape.hits },
    tested: null,
    doc: null,
  };
  if (shape.group !== undefined) state.group = shape.group;
  return state;
}

interface EdgeShape {
  event: string;
  to: string | null;
  kind?: VizEdge["kind"];
}

/** A test edge with the id `from-event-to`, `?` for an unknown target. */
export function edgeOf(from: string, shape: EdgeShape): VizEdge {
  const target = shape.to ?? "?";
  return {
    id: `${from}-${shape.event}-${target}`,
    from,
    event: shape.event,
    to: shape.to,
    kind: shape.kind ?? "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

interface MachineShape {
  states: VizState[];
  edges: VizEdge[];
  regions?: string[];
  maps?: string[];
}

/** A test machine that starts at its initial root state. */
export function machineOf(shape: MachineShape): VizMachine {
  const start = shape.states.find((state) => state.initial && state.region === null);
  return {
    id: "shop",
    initial: start?.id ?? null,
    regions: shape.regions ?? [],
    maps: shape.maps ?? [],
    actors: [],
    states: shape.states,
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: shape.edges,
    fuzz: null,
    runs: [],
  };
}

/** The shape of `packages/inspect/src/fixtures/grouped.ts`: a payment group, a shipping group and the cart outside. */
export function groupedCheckout(): VizMachine {
  return machineOf({
    states: [
      stateOf("inCart", { initial: true, effects: ["showCart"] }),
      stateOf("chargingCard", { group: "payment", hits: 2 }),
      stateOf("confirming", { group: "payment", hits: 1 }),
      stateOf("packing", { group: "shipping", effects: ["printLabel"] }),
      stateOf("sent", { group: "shipping", final: true }),
    ],
    edges: [
      edgeOf("__initial__", { event: "", to: "inCart", kind: "initial" }),
      edgeOf("inCart", { event: "checkout", to: "chargingCard" }),
      edgeOf("chargingCard", { event: "charged", to: "confirming" }),
      edgeOf("confirming", { event: "confirmed", to: "packing" }),
      edgeOf("packing", { event: "packed", to: "sent" }),
    ],
  });
}
