import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { createDoorActor } from "./fixtures/factories.ts";
import { createDocumentedActor } from "./fixtures/documented.ts";
import { createVagueNamesActor } from "./fixtures/vague-names.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
import { designErrors, expectNoDesignErrors, unreachableStates } from "./gate.ts";
import { inspect } from "./inspect.ts";
import { join } from "node:path";

const picks = { pick: [{ side: "a" as const }, { side: "b" as const }] };
const FIXTURES = join(import.meta.dirname, "fixtures");

const idle = state("idle")();
const running = state("running")();
const orphan = state("orphan")();
const go = event("go")();

function createOrphanActor() {
  return Actor({
    clock: VirtualClock(),
    inputs: [go],
    states: [idle, running, orphan],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
    },
  });
}

describe("expectNoDesignErrors", () => {
  test("passes for a machine without design errors", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "door",
        create: () => createDoorActor(),
        payloads: { open: [{ by: "key" }, { by: "code" }] },
        fuzz: { iterations: 100 },
      }),
    ).not.toThrow();
  });

  test("stops on an event fuzzing sent without the payload the handler reads", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "door",
        create: () => createDoorActor(),
        fuzz: { iterations: 100 },
      }),
    ).toThrow(
      "door: fuzzing had no payload for 1 event the machine reads, so this check proves nothing yet:\n  - open: read by\nPass `source` (payloads from the event types) or `payloads: { open: [...] }` with a real payload for each case.",
    );
  });

  test("fails on a handler that throws under fuzzing", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "throwing",
        create: () => createThrowingActor(),
        payloads: picks,
      }),
    ).toThrow(/^throwing has 1 design error:\n {2}- pick in idle throws/);
  });

  test("an empty payload that breaks the handler is the refusal first, then the error", () => {
    expect(() =>
      expectNoDesignErrors({ id: "throwing", create: () => createThrowingActor() }),
    ).toThrow(
      /^throwing: fuzzing had no payload for 1 event the machine reads[^]*- pick: read side\n[^\n]*payloads: \{ pick: \[\.\.\.\] \}[^\n]*\n\nthrowing has 1 design error:\n {2}- pick in idle throws/,
    );
  });

  test("fails on a declared state no path leads to", () => {
    expect(() =>
      expectNoDesignErrors({ id: "orphan", create: () => createOrphanActor(), fuzz: false }),
    ).toThrow(/orphan can never be reached\. No transition leads into orphan\./);
  });

  test("lists only states with no path from the initial state", () => {
    const { machine } = inspect({ id: "orphan", create: () => createOrphanActor(), fuzz: false });
    expect(unreachableStates(machine)).toEqual(["orphan"]);
  });

  test("an undetermined edge leaves reachability unproven, so nothing is reported", () => {
    const { machine } = inspect({ id: "orphan", create: () => createOrphanActor(), fuzz: false });
    const edges = machine.edges.map((edge) => (edge.event === "go" ? { ...edge, to: null } : edge));
    expect(unreachableStates({ ...machine, edges })).toEqual([]);
  });
});

describe("names", () => {
  const source = { file: join(FIXTURES, "vague-names.ts"), root: FIXTURES };

  test("with source, a vague name and a missing comment fail the gate, in order", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "vague",
        create: () => createVagueNamesActor(),
        source,
        fuzz: false,
      }),
    ).toThrow(
      [
        "vague has 3 design errors:",
        "  - ready is a vague name. Every word in ready (ready) is a generic status word, so the diagram does not say what happens there. Name what the person sees, like showingPhotos.",
        "  - DONE is a vague name. Every word in DONE (done) is a generic status word, so the diagram does not say what happened. Name what happened, like photosLoaded.",
        '  - showingCart has no description. There is no /** */ comment above state("showingCart"), so the page shows nothing under its name. Add /** what the person sees here */ above state("showingCart").',
      ].join("\n"),
    );
  });

  test("without source, the same machine passes", () => {
    expect(() =>
      expectNoDesignErrors({ id: "vague", create: () => createVagueNamesActor(), fuzz: false }),
    ).not.toThrow();
  });
});

const sender = state("sender")();
const ping = event("ping")();
const hop = event("hop")();

function createUnhandledSendActor() {
  return Actor({
    clock: VirtualClock(),
    inputs: [go],
    internal: [ping],
    states: [sender],
    initial: sender,
    setup: (m) => {
      m.effect(sender, { name: "notify", sends: [ping], fn: () => undefined });
      m.on(sender, { event: go, to: [sender], handler: () => ({ state: sender }) });
    },
  });
}

function createAnyActor(withAnyTarget: boolean) {
  return Actor({
    clock: VirtualClock(),
    inputs: [go, hop],
    states: [idle, running, orphan],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
      m.on(running, { event: go, to: [running], handler: () => ({ state: running }) });
      if (withAnyTarget) m.onAny({ event: hop, to: [orphan], handler: () => ({ state: orphan }) });
    },
  });
}

describe("design error details", () => {
  test("reports an effect that sends an event its state does not handle", () => {
    const { machine } = inspect({
      id: "send",
      create: () => createUnhandledSendActor(),
      fuzz: false,
    });
    expect(designErrors(machine)).toEqual([
      "notify sends ping, but sender has no handler for it. When notify sends ping in sender, the actor goes to __error. Handle ping in sender, or remove ping from the sends of notify.",
    ]);
  });

  test("a state reached only through onAny is not reported", () => {
    const { machine } = inspect({ id: "any", create: () => createAnyActor(true), fuzz: false });
    expect(unreachableStates(machine)).toEqual([]);
  });

  test("a state no onAny edge reaches is still reported", () => {
    const { machine } = inspect({ id: "any", create: () => createAnyActor(false), fuzz: false });
    expect(unreachableStates(machine)).toEqual(["orphan"]);
  });

  test("an effect edge does not make its target reachable", () => {
    const { machine } = inspect({ id: "orphan", create: () => createOrphanActor(), fuzz: false });
    const edges = [
      ...machine.edges,
      {
        ...machine.edges[0]!,
        id: "effect-edge",
        kind: "effect" as const,
        from: "idle",
        to: "orphan",
      },
    ];
    expect(unreachableStates({ ...machine, edges })).toEqual(["orphan"]);
  });

  test("a region state with no way out is reported by its full id", () => {
    const first = state("first")();
    const second = state("second")();
    const child = Actor({
      clock: VirtualClock(),
      inputs: [go],
      states: [first, second],
      initial: first,
      setup: (m) => {
        m.on(first, { event: go, to: [second], handler: () => ({ state: second }) });
      },
    });
    const { machine } = inspect({
      id: "regions",
      fuzz: false,
      create: () =>
        Actor({
          clock: VirtualClock(),
          inputs: [go],
          states: [idle],
          initial: idle,
          regions: { child },
          setup: (m) => {
            m.on(idle, { event: go, to: [idle], handler: () => ({ state: idle }) });
          },
        }),
    });
    expect(machine.states.map((each) => each.id)).toContain("child.first");
    const errors = designErrors(machine);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^child\.second is a dead end/);
  });

  test("lists thrown, unhandled-send and orphan errors in that order", () => {
    const { machine } = inspect({
      id: "send",
      create: () => createUnhandledSendActor(),
      fuzz: false,
    });
    const withThrow = {
      ...machine,
      states: [
        ...machine.states,
        { ...machine.states[0]!, id: "lost", initial: false, effects: [] },
      ],
      fuzz: { errors: [{ event: "go", from: "sender", message: "boom", steps: [] }] },
    } as unknown as typeof machine;
    expect(designErrors(withThrow)).toEqual([
      'go in sender throws. Fuzzing sent go in sender and the handler threw "boom", so the actor went to __error. Handle the failure in the handler and return a state for it.',
      "notify sends ping, but sender has no handler for it. When notify sends ping in sender, the actor goes to __error. Handle ping in sender, or remove ping from the sends of notify.",
      "lost can never be reached. No transition leads into lost. From sender, the machine can only reach sender. Add a transition into lost, or remove it.",
    ]);
  });
});

describe("handlers and effects with no description", () => {
  const expected = [
    "finish from any state has no description. The m.onAny handler for finish (documented.ts:41) has no /** */ comment, so the Step list shows nothing under finish. Add /** what happened and what the machine does next */ right before that m.onAny.",
    "last in done has no description. The handler for last in done (documented.ts:43) has no /** */ comment, so the Step list shows nothing under last. Add /** what happened and what the machine does next */ right before that m.on, or before its .on in a chain.",
    'tidy in done has no description. No m.effect(done, …) call has a /** */ comment, so the Step list shows nothing under "Entering done runs:". Add /** what happens while done runs tidy */ right before m.effect(done, …).',
  ];
  const sorted = [expected[0], expected[2], expected[1]];
  const arrowLines = (fuzz: false | { iterations: number }) =>
    designErrors(
      inspect({
        id: "documented",
        create: () => createDocumentedActor(),
        source: { file: join(FIXTURES, "documented.ts"), root: FIXTURES },
        fuzz,
      }).machine,
    ).filter(
      (line) =>
        line.includes("has no description") &&
        !line.includes("above state(") &&
        !line.includes("above event("),
    );

  test("without fuzz", () => {
    expect(arrowLines(false)).toEqual(sorted);
  });

  test("fuzz stay edges collapse into the same notes", () => {
    expect(arrowLines({ iterations: 200 })).toEqual(sorted);
  });
});
