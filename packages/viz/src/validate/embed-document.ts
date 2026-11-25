import type { VizDocument, VizEdge, VizMachine, VizState } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";

/** A state of the shop's machines; `machine` is the embedded machine's id. */
interface ShopState {
  id: string;
  machine?: string;
  /** Omitted: a plain state in the middle. */
  role?: "initial" | "final";
}

/** A declared transition between two states of one machine. */
interface ShopEdge {
  from: string;
  event: string;
  to: string;
}

/** A machine whose states embed the machines they name. */
interface ShopMachine {
  id: string;
  states: ShopState[];
  edges?: ShopEdge[];
}

function stateOf(shopState: ShopState): VizState {
  const state: VizState = {
    id: shopState.id,
    label: shopState.id,
    region: null,
    initial: shopState.role === "initial",
    final: shopState.role === "final",
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
  if (shopState.machine !== undefined) state.machine = shopState.machine;
  return state;
}

function edgeOf(shopEdge: ShopEdge): VizEdge {
  return {
    id: `${shopEdge.from}-${shopEdge.event}-${shopEdge.to}`,
    ...shopEdge,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

function machineOf(shopMachine: ShopMachine): VizMachine {
  const initial = shopMachine.states.find((shopState) => shopState.role === "initial");
  return {
    id: shopMachine.id,
    initial: initial?.id ?? null,
    regions: [],
    maps: [],
    actors: [],
    states: shopMachine.states.map(stateOf),
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: (shopMachine.edges ?? []).map(edgeOf),
    fuzz: null,
    runs: [],
  };
}

export function documentOf(machines: ShopMachine[]): VizDocument {
  return { schemaVersion: VIZ_SCHEMA_VERSION, machines: machines.map(machineOf) };
}
