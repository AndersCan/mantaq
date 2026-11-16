import { expect, test } from "vite-plus/test";
import type { VizMachine, VizState } from "../schema.ts";
import { placeMachine } from "./layout.ts";

const busy = (sends: string[] | null): VizState => ({
  id: "busy",
  label: "busy",
  region: null,
  initial: true,
  final: false,
  effects: [{ name: "chargeTheCustomerCard", sends }],
  coverage: null,
  tested: null,
  doc: null,
});

const machine = (state: VizState): VizMachine => ({
  id: "m",
  initial: "busy",
  regions: [],
  maps: [],
  actors: [],
  states: [state],
  events: [],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  runs: [],
  fuzz: null,
});

const width = (state: VizState) =>
  placeMachine(machine(state)).nodes.find((n) => n.id === "busy")?.width;

test("an effect without declared sends takes no extra room: the ? hint is gone", () => {
  expect(width(busy(null))).toBe(width(busy([])));
});
