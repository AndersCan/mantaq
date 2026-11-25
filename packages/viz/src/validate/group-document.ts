import type { VizMachine, VizState } from "../schema.ts";

/** A state of the shop's checkout machine, by id, and the group its declaration names. */
export interface ShopState {
  id: string;
  group?: string;
}

/** The checkout machine's regions and actor maps around its states. */
export interface ShopParts {
  regions?: string[];
  maps?: string[];
}

export function stateOf(shopState: ShopState): VizState {
  const cut = shopState.id.lastIndexOf(".");
  const state: VizState = {
    id: shopState.id,
    label: shopState.id.slice(cut + 1),
    region: cut === -1 ? null : shopState.id.slice(0, cut),
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
  if (shopState.group !== undefined) state.group = shopState.group;
  return state;
}

export function checkoutOf(states: ShopState[], parts: ShopParts = {}): VizMachine {
  return {
    id: "checkout",
    initial: null,
    regions: parts.regions ?? [],
    maps: parts.maps ?? [],
    actors: [],
    states: states.map(stateOf),
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: [],
    fuzz: null,
    runs: [],
  };
}
