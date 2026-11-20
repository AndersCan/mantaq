import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import type {
  VizEdge,
  VizField,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizStep,
} from "../schema.ts";
import { arrowCandidates } from "./fill.ts";
import { blockedEdges } from "./blocked.ts";

const num: VizField = {
  name: "n",
  type: "number",
  optional: false,
  doc: null,
  input: "number",
  choices: [],
  sample: 0,
};
const ev = (event: string, payload: VizJson, actor?: { map: string; key: string }): VizStep => ({
  kind: "event",
  event,
  payload,
  ...(actor === undefined ? {} : { actor }),
});
const machineWith = (corpus: Array<{ steps: VizStep[]; discovered: string[] }>): VizMachine =>
  ({
    events: [
      { id: "go", internal: false, doc: null, payload: [num] },
      { id: "other", internal: false, doc: null, payload: [num] },
    ],
    fuzz: { corpus, errors: [] },
  }) as unknown as VizMachine;
const edge = { id: "a-go-b", from: "a", event: "go", to: "b", kind: "transition" } as VizEdge;
const at = (steps: VizStep[]) => ({ steps, children: [], removed: [] }) as unknown as VizLiveState;

test("on a run, a next step of another event is not a candidate", () => {
  const machine = machineWith([
    { steps: [ev("go", { n: 1 }), ev("other", { n: 7 })], discovered: [] },
  ]);
  const live = at([ev("go", { n: 1 })]);
  const listed = arrowCandidates(machine, edge, { set: {}, live, afters: [] });
  expect(listed).not.toContainEqual({ n: 7 });
});

test("a set value that does not fit its field is not laid over a run's payload", () => {
  const machine = machineWith([{ steps: [ev("go", { n: 1 })], discovered: [] }]);
  const listed = arrowCandidates(machine, edge, {
    set: { n: "x" },
    live: null,
    afters: [],
  });
  expect(listed).toContainEqual({ n: 1 });
});

test("a payload that stays put does not take a self-loop arrow", () => {
  const loop = {
    id: "a-go-a",
    from: "workersBusy",
    event: "go",
    to: "workersBusy",
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    doc: null,
    coverage: null,
    tested: null,
    explanation: {
      status: "analyzed",
      location: { file: "f.ts", line: 1, column: 1 },
      registration: "on",
      branches: [],
      payloadReads: [],
      contextReads: ["ok"],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    },
  } as VizEdge;
  const team = JSON.parse(
    readFileSync(new URL("./reference/team-inbox.json", import.meta.url), "utf8"),
  ) as VizMachine;
  const machine = { ...team, maps: [], edges: [loop] } as unknown as VizMachine;
  const stay: VizLiveStep = {
    from: "workersBusy",
    event: "go",
    to: "workersBusy",
    outcome: "stay",
    effects: [],
    sent: [],
    context: null,
    error: null,
  };
  const { blocked } = blockedEdges(machine, {
    live: { context: { ok: false } } as unknown as VizLiveState,
    currents: ["workersBusy"],
    candidatesOf: () => [1, 2],
    defaultOf: () => 1,
    dryRun: (steps) => steps.map(() => stay),
    actorOf: () => undefined,
  });
  expect(blocked.get("a-go-a")).toBe("go is blocked: ok is false");
});
