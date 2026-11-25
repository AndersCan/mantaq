import type { VizEdge, VizMachine } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { expect, test } from "vite-plus/test";
import { annotateWith } from "./annotate.ts";
import type { HandlerSite, SourceDocs } from "./annotate.ts";

const SOURCE = { file: "/root/src/app.ts", root: "/root" };

const edge: VizEdge = {
  id: "e",
  from: "idle",
  event: "go",
  to: "done",
  kind: "transition",
  origin: "probe",
  emits: [],
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
};

const machine = {
  id: "m",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: [
    {
      id: "idle",
      label: "idle",
      region: null,
      initial: true,
      final: false,
      effects: [],
      coverage: null,
      doc: null,
    },
  ],
  events: [{ id: "go", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edge],
  fuzz: null,
  runs: [],
} as unknown as VizMachine;

function site(doc: string, overrides: Partial<HandlerSite> = {}): HandlerSite {
  return {
    state: "idle",
    event: "go",
    eventPattern: null,
    eventDoc: null,
    doc,
    explanation: { status: "not_analyzed", location: null, reason: doc, snippet: null },
    ...overrides,
  };
}

function docs(overrides: Partial<SourceDocs>): SourceDocs {
  return {
    sites: [],
    stateDocs: new Map(),
    stateGroups: new Map(),
    eventDocs: new Map(),
    effectDocs: new Map(),
    eventPayloads: new Map(),
    elsewhere: [],
    ...overrides,
  };
}

/** What another file supplies, and its import distance from the machine file (default 1). */
interface OtherFile extends Partial<SourceDocs> {
  depth?: number;
}

function other(file: string, options: OtherFile) {
  const { depth = 1, ...overrides } = options;
  const { sites, stateDocs, stateGroups, eventDocs, effectDocs } = docs(overrides);
  return { file, depth, sites, stateDocs, stateGroups, eventDocs, effectDocs };
}

function annotate(analysis: SourceDocs) {
  return annotateWith(machine, { analysis: Either.right(analysis), source: SOURCE });
}

test("two other files registering the same state and event are not analyzed, naming both", () => {
  const result = annotate(
    docs({
      elsewhere: [other("a.ts", { sites: [site("A")] }), other("b.ts", { sites: [site("B")] })],
    }),
  );
  expect(result.edges[0]?.explanation).toMatchObject({
    status: "not_analyzed",
    reason: "handlers for (idle, go) found in more than one file: a.ts, b.ts",
  });
  expect(result.edges[0]?.doc).toBe(null);
});

test("of two other files registering the same state and event, the one nearer by imports is read", () => {
  const result = annotate(
    docs({
      elsewhere: [
        other("far.ts", { sites: [site("Far")], depth: 3 }),
        other("near.ts", { sites: [site("Near")], depth: 1 }),
      ],
    }),
  );
  expect(result.edges[0]?.doc).toBe("Near");
});

test("the machine file's own registration wins over another file's", () => {
  const result = annotate(
    docs({ sites: [site("Own")], elsewhere: [other("a.ts", { sites: [site("A")] })] }),
  );
  expect(result.edges[0]?.doc).toBe("Own");
});

test("the machine file's own state and event descriptions win over a supplier's", () => {
  const result = annotate(
    docs({
      stateDocs: new Map([["idle", "Own idle."]]),
      eventDocs: new Map([["go", "Own go."]]),
      elsewhere: [
        other("a.ts", {
          sites: [site("A")],
          stateDocs: new Map([["idle", "Lent idle."]]),
          eventDocs: new Map([["go", "Lent go."]]),
        }),
      ],
    }),
  );
  expect(result.states[0]?.doc).toBe("Own idle.");
  expect(result.events[0]?.doc).toBe("Own go.");
});

test("a supplier's described event lends to an event the machine file does not describe", () => {
  const result = annotate(
    docs({
      elsewhere: [other("a.ts", { sites: [site("A")], eventDocs: new Map([["go", "Lent go."]]) })],
    }),
  );
  expect(result.events[0]?.doc).toBe("Lent go.");
});

test("a file that supplied no handler lends no event description", () => {
  const result = annotate(
    docs({
      sites: [site("Own")],
      elsewhere: [other("a.ts", { eventDocs: new Map([["go", "Lent go."]]) })],
    }),
  );
  expect(result.events[0]?.doc).toBe(null);
});

test("a supplier's state group lends to a state, and the machine file's own group wins", () => {
  const lent = other("a.ts", { sites: [site("A")], stateGroups: new Map([["idle", "lent"]]) });
  function groupOf(stateGroups: Map<string, string>): string | undefined {
    return annotate(docs({ stateGroups, elsewhere: [lent] })).states[0]?.group;
  }
  expect([groupOf(new Map()), groupOf(new Map([["idle", "own"]]))]).toEqual(["lent", "own"]);
});

test("a state in an actor map gets no group, a state in a plain region does", () => {
  const [idle] = machine.states;
  const regioned = {
    ...machine,
    regions: ["orders", "payment"],
    maps: ["orders"],
    states: idle
      ? [
          { ...idle, id: "orders.idle" },
          { ...idle, id: "payment.paying" },
        ]
      : [],
  };
  const stateGroups = new Map([
    ["idle", "waiting"],
    ["paying", "waiting"],
  ]);
  const analysis = docs({ stateGroups });
  const result = annotateWith(regioned, { analysis: Either.right(analysis), source: SOURCE });
  expect(result.states.map((state) => state.group)).toEqual([undefined, "waiting"]);
});
