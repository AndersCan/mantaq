// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";

/** a --go(n>=1)--> b; in b: go(n=1) --> c, any other n stays. Nothing goes b --> d. */
function where(at: string, step: VizStep): string {
  const n = step.kind === "event" ? (step.payload as { n: number }).n : 0;
  if (at === "a") return n >= 1 ? "b" : "a";
  if (at === "b") return n === 1 ? "c" : "b";
  return at;
}

function fakeDriver() {
  const sent: VizStep[] = [];
  const run = (steps: ReadonlyArray<VizStep>) => {
    let at = "a";
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      const from = at;
      at = where(at, step);
      last = {
        from,
        event: "go",
        to: at,
        outcome: from === at ? "stay" : "transition",
        effects: [],
        sent: [],
        context: {},
        error: null,
      };
    }
    const live: VizLiveState = {
      state: at,
      steps: [...steps],
      last,
      after: [],
      timers: [],
      context: {},
      payload: null,
      regions: {},
      children: [],
      effectMode: "held",
      waiting: [],
    };
    return { live, last };
  };
  const driver: VizDriver = {
    reset: () => ((sent.length = 0), run([]).live),
    step: (step) => (sent.push(step), run(sent).live),
    listen: () => {},
    dryRun: (candidates) => candidates.map((each) => run([...sent, each]).last),
  };
  return { driver, sent };
}

const stateOf = (id: string, initial = false): VizState => ({
  id,
  label: id,
  region: null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});
const edgeOf = (from: string, to: string): VizEdge => ({
  id: `${from}-go-${to}`,
  from,
  event: "go",
  to,
  kind: "transition",
  origin: "declared",
  emits: [],
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});
const go = (n: number): VizStep => ({ kind: "event", event: "go", payload: { n } });

const machine: VizMachine = {
  id: "m",
  initial: "a",
  regions: [],
  maps: [],
  actors: [],
  states: [stateOf("a", true), stateOf("b"), stateOf("c"), stateOf("d")],
  events: [
    {
      id: "go",
      internal: false,
      doc: null,
      payload: [
        {
          name: "n",
          type: "number",
          optional: false,
          doc: null,
          input: "number",
          choices: [],
          sample: 0,
        },
      ],
    },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edgeOf("a", "b"), edgeOf("b", "c"), edgeOf("b", "d")],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    errors: [],
    failedExpectations: [],
    expectations: [],
    corpus: [{ steps: [go(1), go(7)], discovered: [] }],
  },
};

const arrow = (root: HTMLElement, id: string) =>
  root.querySelector<SVGElement>(`[data-edge-id="${id}"]`);
const click = (root: HTMLElement, id: string) =>
  arrow(root, id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

test("on a run, an arrow nothing takes is locked with the default's reason, as before", () => {
  const { driver, sent } = fakeDriver();
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  click(root, "a-go-b");
  expect(sent).toEqual([go(1)]); // the walk is on the run; the default is now n=1 (walk-sent)
  // n=1 (the default) goes to c, n=7 (the run's next step) stays: nothing takes b --> d.
  expect(arrow(root, "b-go-d")?.classList.contains("blocked")).toBe(true);
  click(root, "b-go-d");
  expect(sent).toHaveLength(1);
});
