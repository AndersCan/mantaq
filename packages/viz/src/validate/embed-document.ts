import type { VizDocument, VizMachine, VizState } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";

/** A state of the shop's machines; `machine` is the embedded machine's id. */
interface ShopState {
  id: string;
  machine?: string;
}

/** A machine whose states embed the machines they name. */
interface ShopMachine {
  id: string;
  states: ShopState[];
}

function stateOf(shopState: ShopState): VizState {
  const state: VizState = {
    id: shopState.id,
    label: shopState.id,
    region: null,
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
  if (shopState.machine !== undefined) state.machine = shopState.machine;
  return state;
}

function machineOf(shopMachine: ShopMachine): VizMachine {
  return {
    id: shopMachine.id,
    initial: null,
    regions: [],
    maps: [],
    actors: [],
    states: shopMachine.states.map(stateOf),
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: [],
    fuzz: null,
    runs: [],
  };
}

export function documentOf(machines: ShopMachine[]): VizDocument {
  return { schemaVersion: VIZ_SCHEMA_VERSION, machines: machines.map(machineOf) };
}
