import { describe, expect, test } from "vite-plus/test";
import { FINDING_KINDS, machineFindings, unreachableStates } from "./findings.ts";
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
      { kind: "handlerError", state: "idle", message: "pick in idle throws: boom", steps: [stepA] },
    ]);
  });

  test("unreachable state has no path", () => {
    const machine = build({
      states: [vizState("idle", { initial: true }), vizState("orphan")],
      edges: [vizEdge("idle", "idle", "stay")],
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "unreachableState",
        state: "orphan",
        message: "state orphan is declared but no path leads to it from the initial state",
        steps: null,
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
          message: "state waiting has no way out and is not final",
          steps: null,
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
        message: "effect notify in sender sends ping, but sender has no handler for it",
        steps: [],
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
      },
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "neverSee",
        state: "payment",
        message: 'state payment reached never-see context {"address":""}',
        steps: [stepA, stepB],
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
      },
    });
    expect(machineFindings(machine)).toEqual([
      {
        kind: "mustSee",
        state: "payment",
        message: 'state payment never reached must-see context {"address":""} in 2000 fuzz runs',
        steps: null,
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

  test("names the two naming findings", () => {
    expect(FINDING_KINDS.vagueName.title).toBe("Vague name");
    expect(FINDING_KINDS.undocumented.title).toBe("No description");
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
    expect(namingKinds(machine)).toEqual([
      {
        kind: "vagueName",
        state: "ready",
        message:
          "state ready has a vague name (only generic words: ready); name what the person sees, like showingPhotos",
        steps: null,
      },
      {
        kind: "vagueName",
        state: "ready",
        message:
          "event DONE has a vague name (only generic words: done); name what happened, like photosLoaded",
        steps: null,
      },
      {
        kind: "undocumented",
        state: "showingCart",
        message:
          'state showingCart has no doc comment: add /** what the person sees here */ above state("showingCart")',
        steps: null,
      },
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

  test("an onAny event is placed on the first state it covers", () => {
    const machine = named({
      initial: "alpha",
      states: [stateNamed("alpha"), stateNamed("beta")],
      edges: [analyzedEdge("*", "beta", "DONE")],
      events: [eventNamed("DONE")],
    });
    expect(namingKinds(machine).map((finding) => finding.state)).toEqual(["alpha"]);
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

describe("FINDING_KINDS", () => {
  test("titles every kind", () => {
    expect(Object.keys(FINDING_KINDS).sort()).toEqual([
      "deadEnd",
      "handlerError",
      "mustSee",
      "neverSee",
      "undocumented",
      "unhandledSend",
      "unreachableState",
      "vagueName",
    ]);
  });
});
