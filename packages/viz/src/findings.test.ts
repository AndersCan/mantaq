import { describe, expect, test } from "vite-plus/test";
import { machineFindings, names, unreachableStates } from "./findings.ts";
import type { VizMachine, VizStep } from "./schema.ts";

function vizState(id: string, extra: Record<string, unknown> = {}) {
  return { id, label: id, region: null, initial: false, final: false, effects: [], ...extra };
}

function vizEdge(from: string, to: string | null, event = "go") {
  return { id: `${from}>${event}>${to}`, from, to, event, kind: "transition" };
}

function build(parts: Record<string, unknown>): VizMachine {
  return {
    id: "m",
    states: [],
    edges: [],
    events: [],
    fuzz: null,
    ...parts,
  } as unknown as VizMachine;
}

const stepA: VizStep = { kind: "event", event: "a", payload: null } as VizStep;
const stepB: VizStep = { kind: "event", event: "b", payload: null } as VizStep;

describe("machineFindings", () => {
  test("a machine without findings has none", () => {
    const machine = build({
      states: [vizState("idle", { initial: true }), vizState("done", { final: true })],
      edges: [vizEdge("idle", "done")],
    });
    expect(machineFindings(machine)).toEqual([]);
  });

  test("handler error names its state and carries the fuzz steps", () => {
    const machine = build({
      states: [vizState("idle", { initial: true })],
      edges: [vizEdge("idle", "idle", "stay")],
      fuzz: {
        errors: [{ from: "idle", event: "pick", message: "boom", steps: [stepA] }],
        corpus: [],
      },
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "handlerError",
        state: "idle",
        event: "pick",
        note: false,
        title: "pick in idle throws",
        proof:
          'Fuzzing sent pick in idle and the handler threw "boom", so the actor went to __error.',
        fix: "Handle the failure in the handler and return a state for it.",
        message:
          'pick in idle throws. Fuzzing sent pick in idle and the handler threw "boom", so the actor went to __error. Handle the failure in the handler and return a state for it.',
        steps: [stepA],
        noReplay: null,
      },
    ]);
  });

  test("unreachable state has no path", () => {
    const machine = build({
      initial: "idle",
      states: [vizState("idle", { initial: true }), vizState("orphan")],
      edges: [vizEdge("idle", "idle", "stay")],
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "unreachableState",
        state: "orphan",
        event: null,
        note: false,
        title: "orphan can never be reached",
        proof: "No transition leads into orphan. From idle, the machine can only reach idle.",
        fix: "Add a transition into orphan, or remove it.",
        message:
          "orphan can never be reached. No transition leads into orphan. From idle, the machine can only reach idle. Add a transition into orphan, or remove it.",
        steps: null,
        noReplay: "Nothing reaches orphan, so there is nothing to replay.",
      },
    ]);
    expect(unreachableStates(machine)).toEqual(["orphan"]);
  });

  describe("dead end", () => {
    const waiting = (extra: Record<string, unknown>, edges: unknown[] = []) =>
      build({
        states: [vizState("idle", { initial: true }), vizState("waiting", extra)],
        edges: [vizEdge("idle", "waiting"), ...edges],
      });

    test("a non-final state with no handler and no effect is reported", () => {
      expect(machineFindings(waiting({}))).toEqual([
        {
          kind: "deadEnd",
          state: "waiting",
          event: null,
          note: false,
          title: "waiting is a dead end",
          proof:
            "The machine gets to waiting by go in idle, but nothing can happen there: no event is handled, no effect runs, and it is not final.",
          fix: "Handle an event in waiting, or make it final.",
          message:
            "waiting is a dead end. The machine gets to waiting by go in idle, but nothing can happen there: no event is handled, no effect runs, and it is not final. Handle an event in waiting, or make it final.",
          steps: null,
          noReplay: "No fuzz run reached waiting, so there is no path to replay.",
        },
      ]);
    });

    test("takes the shortest corpus path", () => {
      const machine = build({
        states: [vizState("idle", { initial: true }), vizState("waiting")],
        edges: [vizEdge("idle", "waiting")],
        fuzz: { errors: [], corpus: [{ steps: [stepA], discovered: ["state:waiting"] }] },
      });
      expect(machineFindings(machine)[0]?.steps).toEqual([stepA]);
    });

    test("a final state is fine", () => {
      expect(machineFindings(waiting({ final: true }))).toEqual([]);
    });

    test("a state that only stays is fine", () => {
      expect(machineFindings(waiting({}, [vizEdge("waiting", "waiting", "stay")]))).toEqual([]);
    });

    test("a state covered by an onAny handler is fine", () => {
      expect(machineFindings(waiting({}, [vizEdge("*", "idle", "reset")]))).toEqual([]);
    });

    test("a state with an effect is fine", () => {
      expect(machineFindings(waiting({ effects: [{ name: "poll", sends: [] }] }))).toEqual([]);
    });

    test("an unreachable state is reported only as unreachable", () => {
      const machine = build({
        states: [vizState("idle", { initial: true }), vizState("orphan")],
        edges: [vizEdge("idle", "idle", "stay")],
      });
      expect(machineFindings(machine).map((f) => f.kind)).toEqual(["unreachableState"]);
    });
  });

  const sending = (initial: boolean, fuzz: unknown) =>
    build({
      states: [
        vizState("idle", { initial: true }),
        vizState("sender", { initial, effects: [{ name: "notify", sends: ["ping"] }] }),
      ],
      edges: [vizEdge("idle", "sender")],
      fuzz,
    });

  test("unhandled send on the initial state has the empty path", () => {
    const machine = build({
      states: [
        vizState("sender", { initial: true, effects: [{ name: "notify", sends: ["ping"] }] }),
      ],
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "unhandledSend",
        state: "sender",
        event: "ping",
        note: false,
        title: "notify sends ping, but sender has no handler for it",
        proof: "When notify sends ping in sender, nothing handles it.",
        fix: "Handle ping in sender, or remove ping from the sends of notify.",
        message:
          "notify sends ping, but sender has no handler for it. When notify sends ping in sender, nothing handles it. Handle ping in sender, or remove ping from the sends of notify.",
        steps: [],
        noReplay: "sender is the start state, so there is nothing to replay.",
      },
    ]);
  });

  test("unhandled send takes the shortest corpus sequence that found the state", () => {
    const machine = sending(false, {
      errors: [],
      corpus: [
        { steps: [stepA, stepB], discovered: ["state:sender"] },
        { steps: [stepB], discovered: ["state:sender"] },
        { steps: [stepA], discovered: ["state:sender"] },
      ],
    });
    expect(machineFindings(machine)[0]?.steps).toEqual([stepB]);
  });

  test("unhandled send without fuzzing has no path", () => {
    expect(machineFindings(sending(false, null))[0]?.steps).toBeNull();
  });

  test("unhandled send the corpus never reached has no path", () => {
    const machine = sending(false, {
      errors: [],
      corpus: [{ steps: [stepA], discovered: ["state:idle"] }],
    });
    expect(machineFindings(machine)[0]?.steps).toBeNull();
  });

  const failed = (kind: string, steps: unknown) => ({
    kind,
    state: "payment",
    match: '{"address":""}',
    steps,
  });

  test("never-see carries the shrunk steps", () => {
    const machine = build({
      states: [vizState("payment", { initial: true })],
      edges: [vizEdge("payment", "payment", "stay")],
      fuzz: {
        iterations: 2000,
        errors: [],
        corpus: [],
        failedExpectations: [failed("neverSee", [stepA, stepB])],
        expectations: [],
      },
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "neverSee",
        state: "payment",
        event: null,
        note: false,
        title: 'payment was reached with {"address":""}',
        proof:
          'The expectations block says payment must never see {"address":""}, and a fuzz run got there.',
        fix: "Reject that input in the handler that leads to payment, or change the expectation.",
        message:
          'payment was reached with {"address":""}. The expectations block says payment must never see {"address":""}, and a fuzz run got there. Reject that input in the handler that leads to payment, or change the expectation.',
        steps: [stepA, stepB],
        noReplay: null,
      },
    ]);
  });

  test("must-see names the run count and has no path", () => {
    const machine = build({
      states: [vizState("payment", { initial: true })],
      edges: [vizEdge("payment", "payment", "stay")],
      fuzz: {
        iterations: 2000,
        errors: [],
        corpus: [],
        failedExpectations: [failed("mustSee", null)],
        expectations: [],
      },
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "mustSee",
        state: "payment",
        event: null,
        note: false,
        title: 'payment was never reached with {"address":""}',
        proof:
          'The expectations block says some run must reach payment with {"address":""}, and none of 2000 fuzz runs did.',
        fix: "Add a recorded run to tests that gets there, or check what blocks the path.",
        message:
          'payment was never reached with {"address":""}. The expectations block says some run must reach payment with {"address":""}, and none of 2000 fuzz runs did. Add a recorded run to tests that gets there, or check what blocks the path.',
        steps: null,
        noReplay: "No run got there, so there is nothing to replay.",
      },
    ]);
  });

  test("orders handler errors, never-see, must-see, unhandled sends, then unreachable states", () => {
    const machine = build({
      states: [
        vizState("idle", { initial: true, effects: [{ name: "notify", sends: ["ping"] }] }),
        vizState("orphan"),
      ],
      edges: [vizEdge("idle", "idle", "stay")],
      fuzz: {
        iterations: 1,
        errors: [{ from: "idle", event: "pick", message: "boom", steps: [] }],
        corpus: [],
        failedExpectations: [failed("mustSee", null), failed("neverSee", [])],
        expectations: [],
      },
    });
    expect(machineFindings(machine).map((finding) => finding.kind)).toEqual([
      "handlerError",
      "neverSee",
      "mustSee",
      "unhandledSend",
      "unreachableState",
    ]);
  });

  test("lists handler errors, then unhandled sends, then unreachable states", () => {
    const machine = build({
      states: [
        vizState("idle", { initial: true, effects: [{ name: "notify", sends: ["ping"] }] }),
        vizState("orphan"),
      ],
      edges: [vizEdge("idle", "idle", "stay")],
      fuzz: { errors: [{ from: "idle", event: "pick", message: "boom", steps: [] }], corpus: [] },
    });
    expect(machineFindings(machine).map((finding) => finding.kind)).toEqual([
      "handlerError",
      "unhandledSend",
      "unreachableState",
    ]);
  });
});

function analyzedEdge(from: string, to: string, event: string) {
  return { ...vizEdge(from, to, event), explanation: { status: "analyzed" } };
}

function named(parts: Record<string, unknown>): VizMachine {
  return build({ initial: "showingHome", ...parts });
}

function namingKinds(machine: VizMachine) {
  return machineFindings(machine).filter(
    (finding) => finding.kind === "vagueName" || finding.kind === "undocumented",
  );
}

function stateNamed(id: string, doc: string | null = "Doc.") {
  return vizState(id, { doc });
}

function eventNamed(id: string, doc: string | null = "Doc.") {
  return { id, internal: false, doc, payload: null };
}

describe("naming findings", () => {
  const vagueTable: [string, boolean, boolean][] = [
    ["ok", true, true],
    ["OK", true, true],
    ["Ok", true, true],
    ["ERROR", false, true],
    ["ACT_FAILED", false, true],
    ["STATUS_FAILED", false, true],
    ["region1.idle", true, true],
    ["loadingPhotos", true, false],
    ["LOAD_FAILED", false, false],
    ["STATUS_SEEN", false, false],
    ["BATCH_DONE", false, false],
    ["paymentOk", true, false],
    ["waitingForAdminApproval", true, false],
    ["SAVED", false, false],
    ["NEXT", false, false],
    ["OPEN", false, false],
    ["QRCodeReady", true, false],
  ];

  test.each(vagueTable)("%s (state: %s) is vague: %s", (name, isState, vague) => {
    const machine = isState
      ? named({
          states: [stateNamed("showingHome", "Doc."), stateNamed(name)],
          edges: [analyzedEdge("showingHome", name, "go")],
          events: [eventNamed("go")],
        })
      : named({
          states: [stateNamed("showingHome")],
          edges: [analyzedEdge("showingHome", "showingHome", name)],
          events: [eventNamed(name)],
        });
    const found = namingKinds(machine).filter((finding) => finding.kind === "vagueName");
    expect(found.length > 0).toBe(vague);
  });

  test("exact findings for a vague state, a vague event and a missing comment", () => {
    const machine = named({
      initial: "ready",
      states: [stateNamed("ready", "Cart is shown."), stateNamed("showingCart", null)],
      edges: [analyzedEdge("ready", "showingCart", "DONE")],
      events: [eventNamed("DONE", "Paid.")],
    });
    expect(namingKinds(machine).map((f) => [f.kind, f.state, f.event, f.note, f.message])).toEqual([
      [
        "vagueName",
        "ready",
        null,
        true,
        "ready is a vague name. Every word in ready (ready) is a generic status word, so the diagram does not say what happens there. Name what the person sees, like showingPhotos.",
      ],
      [
        "vagueName",
        null,
        "DONE",
        true,
        "DONE is a vague name. Every word in DONE (done) is a generic status word, so the diagram does not say what happened. Name what happened, like photosLoaded.",
      ],
      [
        "undocumented",
        "showingCart",
        null,
        true,
        'showingCart has no description. There is no /** */ comment above state("showingCart"), so the page shows nothing under its name. Add /** what the person sees here */ above state("showingCart").',
      ],
    ]);
  });

  test("a machine whose source was not read has no naming findings", () => {
    const machine = named({
      states: [stateNamed("ready", null)],
      edges: [vizEdge("ready", "ready", "DONE")],
      events: [eventNamed("DONE", null)],
    });
    expect(namingKinds(machine)).toEqual([]);
  });

  test("an event-level naming note has no state", () => {
    const machine = named({
      initial: "alpha",
      states: [stateNamed("alpha"), stateNamed("beta")],
      edges: [analyzedEdge("*", "beta", "DONE")],
      events: [eventNamed("DONE")],
    });
    expect(namingKinds(machine).map((finding) => finding.state)).toEqual([null]);
  });

  test("a comment of only whitespace counts as missing", () => {
    const machine = named({
      initial: "alpha",
      states: [stateNamed("alpha", "  ")],
      edges: [analyzedEdge("alpha", "alpha", "stay")],
      events: [eventNamed("stay")],
    });
    expect(namingKinds(machine).map((finding) => finding.kind)).toEqual(["undocumented"]);
  });
});

describe("names", () => {
  test.each([
    [[], ""],
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b and c"],
    [["a", "b", "c", "d", "e", "f"], "a, b, c, d, e and f"],
    [["a", "b", "c", "d", "e", "f", "g", "h"], "a, b, c, d, e, f and 2 more"],
  ])("%j", (ids, text) => {
    expect(names(ids)).toBe(text);
  });
});

describe("unreachable proof", () => {
  test("names the arrow from a state that is unreachable too", () => {
    const machine = build({
      initial: "a",
      states: [
        vizState("a", { initial: true }),
        vizState("b"),
        vizState("orphanA"),
        vizState("orphanB"),
      ],
      edges: [
        vizEdge("a", "b", "x"),
        vizEdge("b", "a", "back"),
        vizEdge("orphanA", "orphanB", "y"),
      ],
    });
    const found = machineFindings(machine).find((f) => f.state === "orphanB");
    expect(found?.proof).toBe(
      "Only y in orphanA leads into orphanB, and orphanA can never be reached either. From a, the machine can only reach a and b.",
    );
    expect(found?.fix).toBe("Make orphanA reachable, or remove orphanB.");
  });

  test("a dead end at the start state replays nothing", () => {
    const machine = build({ initial: "a", states: [vizState("a", { initial: true })] });
    const [dead] = machineFindings(machine);
    expect(dead?.proof).toContain("The machine starts in a,");
    expect(dead?.steps).toEqual([]);
    expect(dead?.noReplay).toBe("a is the start state, so there is nothing to replay.");
  });
});

describe("unhandledEvent", () => {
  const declared = (id: string, internal: boolean) => ({ id, internal, doc: null, payload: null });

  test("an input and an internal event no state handles", () => {
    const machine = build({
      states: [vizState("idle", { initial: true })],
      edges: [vizEdge("idle", "idle", "stay")],
      events: [declared("cancel", false), declared("paid", true)],
    });
    const found = machineFindings(machine).filter((f) => f.kind === "unhandledEvent");
    expect(found.map((f) => f.message)).toEqual([
      "cancel is declared but no state handles it. cancel is an input of m, but no state has a handler for it, so sending it does nothing. Handle cancel in a state, or remove it from inputs.",
      "paid is declared but no state handles it. paid is an internal event of m, but no state has a handler for it: if an effect sends it, the actor goes to __error. Handle paid in a state, or remove it from internal.",
    ]);
    expect(found[0]).toMatchObject({
      state: null,
      event: "cancel",
      note: false,
      steps: null,
      noReplay: "No state handles cancel, so there is nothing to replay.",
    });
  });

  test("not raised when an unhandledSend names the same event", () => {
    const machine = build({
      states: [vizState("idle", { initial: true, effects: [{ name: "notify", sends: ["ping"] }] })],
      edges: [vizEdge("idle", "idle", "stay")],
      events: [declared("ping", false)],
    });
    expect(machineFindings(machine).map((f) => f.kind)).toEqual(["unhandledSend"]);
  });

  test("not raised when an onAny edge handles it", () => {
    const machine = build({
      states: [vizState("idle", { initial: true })],
      edges: [vizEdge("*", "idle", "reset")],
      events: [declared("reset", false)],
    });
    expect(machineFindings(machine)).toEqual([]);
  });
});

describe("unhandledSend text", () => {
  const withEvents = (events: unknown[]) =>
    build({
      states: [vizState("idle", { initial: true, effects: [{ name: "notify", sends: ["ping"] }] })],
      edges: [vizEdge("idle", "idle", "stay")],
      events,
    });

  test("internal events go to __error, inputs are dropped", () => {
    const internal = withEvents([{ id: "ping", internal: true, doc: null, payload: null }]);
    const input = withEvents([{ id: "ping", internal: false, doc: null, payload: null }]);
    expect(machineFindings(internal)[0]?.proof).toBe(
      "When notify sends ping in idle, the actor goes to __error.",
    );
    expect(machineFindings(input)[0]?.proof).toBe(
      "When notify sends ping in idle, it is dropped and the machine stays in idle.",
    );
  });
});

describe("finding invariants", () => {
  test("every finding is consistent", () => {
    const machines = [
      build({
        initial: "a",
        states: [
          vizState("a", { initial: true, effects: [{ name: "go", sends: ["ping"] }] }),
          vizState("orphan"),
          vizState("stuck"),
        ],
        edges: [vizEdge("a", "stuck", "next"), vizEdge("*", "a", "reset")],
        events: [{ id: "extra", internal: false, doc: null, payload: null }],
        fuzz: {
          iterations: 3,
          errors: [{ from: "a", event: "pick", message: "boom", steps: [stepA] }],
          corpus: [],
          failedExpectations: [
            { kind: "mustSee", state: "a", match: "{}", steps: null },
            { kind: "neverSee", state: "a", match: "{}", steps: [stepA] },
          ],
          expectations: [],
        },
      }),
    ];
    for (const machine of machines) {
      const all = machineFindings(machine);
      expect(all.length).toBeGreaterThan(4);
      for (const f of all) {
        expect(f.steps !== null && f.steps.length > 0).toBe(f.noReplay === null);
        expect(f.message).toBe(`${f.title}. ${f.proof} ${f.fix}`);
        expect(f.title).toContain(f.state ?? f.event ?? "");
      }
    }
  });
});

describe("regions", () => {
  const region = (extra: Record<string, unknown> = {}) =>
    build({
      initial: "idle",
      states: [
        vizState("idle", { initial: true }),
        vizState("upload.a", { region: "upload", ...extra }),
        vizState("upload.b", { region: "upload" }),
        vizState("upload.orphan", { region: "upload" }),
      ],
      edges: [vizEdge("idle", "idle", "stay"), vizEdge("upload.a", "upload.b")],
    });

  test("a region is walked from its own start state", () => {
    const machine = region({ initial: true });
    expect(unreachableStates(machine)).toEqual(["upload.orphan"]);
    const kinds = machineFindings(machine).map((each) => `${each.kind} ${each.state}`);
    expect(kinds).toContain("deadEnd upload.b");
    expect(kinds).toContain("unreachableState upload.orphan");
  });

  test("a region with no recorded start is not reported", () => {
    expect(unreachableStates(region())).toEqual([]);
    expect(machineFindings(region()).filter((each) => each.state?.startsWith("upload"))).toEqual(
      [],
    );
  });
});

describe("arrow descriptions", () => {
  const at = (line: number, column = 7) => ({
    status: "analyzed",
    location: { file: "m.ts", line, column },
  });
  const edge = (from: string, to: string, event: string, extra: Record<string, unknown> = {}) => ({
    ...vizEdge(from, to, event),
    doc: null,
    explanation: at(3),
    ...extra,
  });
  const arrowNotes = (machine: VizMachine) =>
    machineFindings(machine).filter(
      (f) => f.title.endsWith("has no description") || f.title.endsWith("have no description"),
    );
  const base = {
    states: [vizState("a", { initial: true, doc: "A." }), vizState("b", { doc: "B." })],
  };

  test("an undocumented handler gives the exact message", () => {
    const [note] = arrowNotes(build({ ...base, edges: [edge("a", "b", "go")] }));
    expect(note?.message).toBe(
      "go in a has no description. The handler for go in a (m.ts:3) has no /** */ comment, so the Step list shows nothing under go. Add /** what happened and what the machine does next */ right before that m.on, or before its .on in a chain.",
    );
    expect(note?.note).toBe(true);
    expect(note?.state).toBe("a");
  });

  test("one handler with two targets and a stay edge gives one note", () => {
    const machine = build({
      ...base,
      edges: [
        edge("a", "b", "go"),
        edge("a", "a", "go", { kind: "stay", id: "s" }),
        edge("a", "a", "go", { id: "t" }),
      ],
    });
    expect(arrowNotes(machine)).toHaveLength(1);
  });

  test("an any edge plus a concrete edge gives one onAny note", () => {
    const machine = build({
      ...base,
      edges: [
        edge("a", "b", "end"),
        edge("*", "b", "end", { id: "any" }),
        edge("b", "b", "end", { id: "bb", kind: "stay" }),
      ],
    });
    const notes = arrowNotes(machine);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.state).toBeNull();
    expect(notes[0]?.message).toBe(
      "end from any state has no description. The m.onAny handler for end (m.ts:3) has no /** */ comment, so the Step list shows nothing under end. Add /** what happened and what the machine does next */ right before that m.onAny.",
    );
  });

  test("a chain gives one note per event", () => {
    const machine = build({ ...base, edges: [edge("a", "b", "one"), edge("a", "b", "two")] });
    expect(arrowNotes(machine).map((f) => f.event)).toEqual(["one", "two"]);
  });

  test("an edge without a location gives no note", () => {
    const machine = build({
      ...base,
      edges: [
        edge("a", "b", "go", { explanation: { status: "not_analyzed", location: null } }),
        edge("a", "b", "x", { explanation: { status: "analyzed" } }),
      ],
    });
    expect(arrowNotes(machine)).toEqual([]);
  });

  test("a doc of only spaces counts as missing, a real doc does not", () => {
    const blank = build({ ...base, edges: [edge("a", "b", "go", { doc: "  " })] });
    expect(arrowNotes(blank)).toHaveLength(1);
    const documented = build({ ...base, edges: [edge("a", "b", "go", { doc: "Moves on." })] });
    expect(arrowNotes(documented)).toEqual([]);
  });

  test("effects without a description say has or have", () => {
    const effectEdge = { ...vizEdge("a", "a", "effect:a"), kind: "effect", doc: null };
    const one = build({
      states: [vizState("a", { initial: true, doc: "A.", effects: [{ name: "tidy" }] })],
      edges: [effectEdge],
    });
    const [note] = arrowNotes(one);
    expect(note?.message).toBe(
      'tidy in a has no description. No m.effect(a, …) call has a /** */ comment, so the Step list shows nothing under "Entering a runs:". Add /** what happens while a runs tidy */ right before m.effect(a, …).',
    );
    const two = build({
      states: [
        vizState("a", { initial: true, doc: "A.", effects: [{ name: "tidy" }, { name: "sweep" }] }),
      ],
      edges: [effectEdge],
    });
    expect(arrowNotes(two)[0]?.title).toBe("tidy and sweep in a have no description");
  });

  test("a machine whose source was not read gives no arrow notes", () => {
    const machine = build({
      states: [vizState("a", { initial: true }), vizState("b")],
      edges: [
        {
          ...vizEdge("a", "b", "go"),
          doc: null,
          explanation: { status: "not_analyzed", location: { file: "m.ts", line: 1, column: 1 } },
        },
      ],
    });
    expect(arrowNotes(machine)).toEqual([]);
  });

  test("arrow notes come after undocumented event notes", () => {
    const machine = build({
      states: [
        vizState("a", { initial: true, doc: "A." }),
        vizState("b", { doc: "B.", final: true }),
      ],
      events: [{ id: "go", doc: null }],
      edges: [edge("a", "b", "go")],
    });
    expect(machineFindings(machine).map((f) => f.title)).toEqual([
      "go has no description",
      "go in a has no description",
    ]);
  });
});
