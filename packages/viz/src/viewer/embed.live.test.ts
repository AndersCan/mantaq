// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizField,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizOutputRoutes,
  VizState,
  VizStep,
} from "../schema.ts";
import { decodeLiveSteps, encodeLiveStep, payloadSamples } from "../moves.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test, vi } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: flags.initial ?? false,
    final: flags.final ?? false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
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

const checkout: VizMachine = {
  id: "checkout",
  initial: "idle",
  regions: [],
  maps: [],
  states: [state("idle", { initial: true }), state("paying"), state("error", { final: true })],
  events: [
    { id: "submit", internal: false, doc: null, payload: null },
    { id: "paymentTimeout", internal: true, doc: null, payload: null },
  ],
  outputs: [],
  context: null,
  edges: [edge("idle", "submit", "paying"), edge("paying", "paymentTimeout", "error")],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [
      {
        steps: [
          { kind: "event", event: "submit", payload: { amount: 5 } },
          { kind: "event", event: "submit", payload: { amount: 5 } },
          { kind: "event", event: "submit", payload: { amount: 9 } },
        ],
        discovered: [],
      },
    ],
    errors: [],
    failedExpectations: [],
    expectations: [],
  },
};

/** A pure function of the step log, like the real driver after reset + replay. */
function driver(held: VizJson = null): VizDriver & { log: VizStep[][] } {
  const log: VizStep[][] = [];
  const run = (steps: VizStep[]): VizLiveState => {
    let now = 0;
    let current = "idle";
    let deadline: number | null = null;
    let context: VizLiveState["context"] = null;
    for (const step of steps) {
      if (step.kind === "advance") now += step.ms;
      else if (step.event === "nope") throw new Error("unknown event nope");
      else if (step.event === "submit" && current === "idle") {
        current = "paying";
        deadline = now + 800;
        context = step.payload;
      }
      if (current === "paying" && deadline !== null && now >= deadline) current = "error";
    }
    return {
      state: current,
      steps,
      last: null,
      after: [],
      timers:
        current === "paying" && deadline !== null
          ? [{ id: "t1", ms: 800, deadline, eventName: "paymentTimeout" }]
          : [],
      context,
      payload: held,
      regions: {},
      children: [],
      effectMode: "real",
      waiting: [],
    };
  };
  const done: VizStep[] = [];
  return {
    log,
    reset: () => {
      done.length = 0;
      return run([]);
    },
    step: (step) => {
      done.push(step);
      log.push([...done]);
      return run([...done]);
    },
  };
}

function mount(
  options: {
    steps?: string[];
    onNavigate?: (w: { steps: string[] }) => void;
  } = {},
) {
  const root = document.createElement("div");
  const live = driver();
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
    {
      driver: live,
      ...options,
    },
  );
  return { root, live };
}

const click = (root: HTMLElement, selector: string) =>
  root.querySelector<HTMLButtonElement>(selector)?.click();
/** Opens the payload form of `submit`, optionally types JSON, then sends. */
function sendSubmit(root: HTMLElement, json?: string) {
  click(root, '[data-send="submit"]');
  const box = root.querySelector<HTMLTextAreaElement>('[data-payload-json="submit"]');
  if (box && json !== undefined) box.value = json;
  click(root, '[data-payload-send="submit"]');
}
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");

const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("live controls", () => {
  test("a timer button advances the clock to its deadline", () => {
    const { root } = mount();
    expect(root.querySelector("[data-advance-timer]")).toBeNull();
    sendSubmit(root);
    const timer = root.querySelector("[data-advance-timer]");
    expect(timer?.textContent).toBe("advance 800 ms → paymentTimeout");
    click(root, "[data-advance-timer]");
    expect(current(root)).toBe("error");
    expect(root.querySelector('[data-rewind="2"]')?.textContent).toBe("advance 800 ms");
  });

  test("the timer label counts down the time already advanced", () => {
    const { root } = mount();
    sendSubmit(root);
    const input = root.querySelector<HTMLInputElement>("[data-advance-ms]");
    if (input) input.value = "300";
    click(root, "[data-advance]");
    expect(current(root)).toBe("paying");
    expect(root.querySelector("[data-advance-timer]")?.textContent).toBe(
      "advance 500 ms → paymentTimeout",
    );
  });

  test("free advance sends the typed milliseconds and rejects bad input", () => {
    const { root, live } = mount();
    const input = root.querySelector<HTMLInputElement>("[data-advance-ms]");
    if (input) input.value = "-5";
    click(root, "[data-advance]");
    expect(live.log).toEqual([]);
    expect(root.querySelector(".explore-time [role=alert]")?.hasAttribute("hidden")).toBe(false);
    const again = root.querySelector<HTMLInputElement>("[data-advance-ms]");
    if (again) again.value = "250";
    click(root, "[data-advance]");
    expect(live.log).toEqual([[{ kind: "advance", ms: 250 }]]);
  });

  test("JSON payload is sent with the event", () => {
    const { root, live } = mount();
    sendSubmit(root, '{"amount":42}');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { amount: 42 } }]);
    expect(root.querySelector("[data-live-context]")?.textContent).toBe('{\n  "amount": 42\n}');
  });

  test("invalid JSON sends nothing and keeps the form open", () => {
    const { root, live } = mount();
    sendSubmit(root, "{nope");
    expect(live.log).toEqual([]);
    expect(root.querySelector(".explore-payload [role=alert]")?.hasAttribute("hidden")).toBe(false);
  });

  test("an event with a payload asks for it, filled with the first sample", () => {
    const { root, live } = mount();
    click(root, '[data-send="submit"]');
    expect(live.log).toEqual([]);
    const box = root.querySelector<HTMLTextAreaElement>('[data-payload-json="submit"]');
    expect(box?.value).toBe('{"amount":5}');
    const samples = [...root.querySelectorAll('[data-payload-form="submit"] [data-sample]')];
    expect(samples.map((each) => each.textContent)).toEqual(["sample 1", "sample 2"]);
    click(root, '[data-payload-form="submit"] [data-sample="1"]');
    expect(box?.value).toBe('{"amount":9}');
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { amount: 9 } }]);
    expect(root.querySelector("[data-payload-form]")).toBeNull();
  });

  test("Send is the only primary button in the payload form", () => {
    const { root } = mount();
    click(root, '[data-send="submit"]');
    const primary = [...root.querySelectorAll('[data-payload-form="submit"] button.primary')];
    expect(primary.map((each) => each.getAttribute("data-payload-send"))).toEqual(["submit"]);
  });

  test("cancel closes the form without sending", () => {
    const { root, live } = mount();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-cancel="submit"]');
    expect(live.log).toEqual([]);
    expect(root.querySelector("[data-payload-form]")).toBeNull();
  });

  test("an edge click sends the first fuzz payload at once", () => {
    const { root, live } = mount();
    clickEdge(root, "idle-submit-paying");
    expect(live.log).toEqual([[{ kind: "event", event: "submit", payload: { amount: 5 } }]]);
    expect(root.querySelector(".payload-sheet")).toBeNull();
  });

  test("a second click on the same event sends what this walk sent last", () => {
    const toggle: VizMachine = {
      ...checkout,
      states: [state("off", { initial: true }), state("on")],
      initial: "off",
      events: [{ id: "flip", internal: false, doc: null, payload: null }],
      edges: [edge("off", "flip", "on"), edge("on", "flip", "off")],
      fuzz: {
        ...checkout.fuzz!,
        corpus: [{ steps: [{ kind: "event", event: "flip", payload: { n: 1 } }], discovered: [] }],
      },
    };
    const log: VizStep[] = [];
    const flip: VizDriver = {
      reset: () => flipState([]),
      step: (step) => {
        log.push(step);
        return flipState([...log]);
      },
    };
    function flipState(steps: VizStep[]): VizLiveState {
      return {
        state: steps.length % 2 === 0 ? "off" : "on",
        steps,
        last: null,
        after: [],
        timers: [],
        context: null,
        payload: null,
        regions: {},
        children: [],
        effectMode: "real",
        waiting: [],
      };
    }
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [toggle] }, { driver: flip });
    click(root, "[data-always-ask]");
    click(root, '[data-send="flip"]');
    const box = root.querySelector<HTMLTextAreaElement>('[data-payload-json="flip"]');
    if (box) box.value = '{"n": 42}';
    click(root, '[data-payload-send="flip"]');
    click(root, "[data-always-ask]");
    clickEdge(root, "on-flip-off");
    expect(log.at(-1)).toEqual({ kind: "event", event: "flip", payload: { n: 42 } });
    expect(root.querySelector(".payload-sheet")).toBeNull();
    click(root, "[data-always-ask]");
    click(root, '[data-send="flip"]');
    expect(root.querySelector<HTMLTextAreaElement>('[data-payload-json="flip"]')?.value).toBe(
      '{"n":42}',
    );
  });

  test("a value sent from the form is forgotten when Back undoes that send", () => {
    const { root, live } = mount();
    click(root, "[data-always-ask]");
    click(root, '[data-send="submit"]');
    const box = root.querySelector<HTMLTextAreaElement>('[data-payload-json="submit"]');
    if (box) box.value = '{"amount": 42}';
    click(root, '[data-payload-send="submit"]');
    click(root, "[data-always-ask]");
    click(root, '[data-explore-action="back"]');
    clickEdge(root, "idle-submit-paying");
    expect(live.log.at(-1)).toEqual([{ kind: "event", event: "submit", payload: { amount: 5 } }]);
  });

  test("Always ask opens the form on an edge click", () => {
    const { root, live } = mount();
    click(root, "[data-always-ask]");
    expect(root.querySelector("[data-always-ask]")?.getAttribute("aria-pressed")).toBe("true");
    clickEdge(root, "idle-submit-paying");
    expect(live.log).toEqual([]);
    expect(root.querySelector('.payload-sheet [data-payload-form="submit"]')).not.toBeNull();
    expect(root.querySelector(".payload-sheet")?.getAttribute("aria-label")).toBe(
      "Payload for submit",
    );
    const marked = [...root.querySelectorAll("[data-composing]")];
    expect(marked.map((each) => each.getAttribute("data-edge-id"))).toEqual(["idle-submit-paying"]);
  });

  test("Always ask survives a re-render and toggles off", () => {
    const { root, live } = mount();
    click(root, "[data-always-ask]");
    click(root, "[data-always-ask]");
    expect(root.querySelector("[data-always-ask]")?.getAttribute("aria-pressed")).toBe("false");
    clickEdge(root, "idle-submit-paying");
    expect(live.log).toHaveLength(1);
  });

  test("Always ask is hidden when no event takes a payload, and without a driver", () => {
    const plain: VizMachine = { ...checkout, fuzz: null };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [plain] },
      { driver: driver() },
    );
    expect(root.querySelector("[data-always-ask]")).toBeNull();
    const staticRoot = document.createElement("div");
    mountViewer(staticRoot, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] });
    expect(staticRoot.querySelector("[data-always-ask]")).toBeNull();
  });

  test("clicks never scroll or rebuild the canvas", () => {
    const { root } = mount();
    const canvas = root.querySelector(".canvas");
    const scroll = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => undefined);
    clickEdge(root, "idle-submit-paying");
    clickEdge(root, "paying-paymentTimeout-error");
    root.querySelector("[data-node-id]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click(root, "[data-send]");
    expect(canvas).not.toBeNull();
    expect(root.querySelector(".canvas")).toBe(canvas);
    expect(scroll).not.toHaveBeenCalled();
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
    vi.restoreAllMocks();
  });

  test("the Send list opens the same sheet, and Escape closes it", () => {
    const { root, live } = mount();
    click(root, '[data-send="submit"]');
    const sheet = root.querySelector(".payload-sheet");
    expect(sheet).not.toBeNull();
    expect(root.querySelector(".panel [data-payload-form]")).toBeNull();
    sheet?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector(".payload-sheet")).toBeNull();
    expect(root.querySelector("[data-composing]")).toBeNull();
    expect(live.log).toEqual([]);
  });

  test("back replays the log without the last step", () => {
    const { root } = mount();
    sendSubmit(root);
    click(root, "[data-advance-timer]");
    click(root, '[data-explore-action="back"]');
    expect(current(root)).toBe("paying");
    expect(root.querySelectorAll("[data-rewind]")).toHaveLength(2);
  });

  test("the URL steps round-trip to the same state", () => {
    const seen: string[][] = [];
    const first = mount({ onNavigate: (where) => seen.push(where.steps) });
    sendSubmit(first.root, '{"amount":42}');
    click(first.root, "[data-advance-timer]");
    const steps = seen.at(-1) ?? [];
    expect(steps).toEqual(['submit={"amount":42}', "@800"]);
    const second = mount({ steps });
    expect(current(second.root)).toBe(current(first.root));
    expect(second.root.querySelector("[data-live-context]")?.textContent).toBe(
      first.root.querySelector("[data-live-context]")?.textContent,
    );
  });
});

describe("runs", () => {
  const submit: VizStep = {
    kind: "event",
    event: "submit",
    payload: { amount: 5 },
  };
  const withRuns: VizMachine = {
    ...checkout,
    runs: [
      {
        name: "pays and times out",
        steps: [submit, { kind: "advance", ms: 800 }],
      },
      { name: "submits", steps: [submit] },
      { name: "empty", steps: [] },
      {
        name: "breaks",
        steps: [{ kind: "event", event: "nope", payload: null }, submit],
      },
    ],
  };

  function mountRuns(onNavigate: (w: { steps: string[]; run?: string }) => void = () => undefined) {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRuns] },
      { driver: driver(), onNavigate },
    );
    return root;
  }

  test("lists each run by name", () => {
    const root = mountRuns();
    const names = [...root.querySelectorAll("[data-run]")].map((each) => each.textContent);
    expect(names).toEqual(["pays and times out", "submits", "empty", "breaks"]);
  });

  test("clicking a run replays it from a fresh actor and updates the URL steps", () => {
    const seen: string[][] = [];
    const root = mountRuns((where) => seen.push(where.steps));
    sendSubmit(root);
    click(root, '[data-run="pays and times out"]');
    expect(current(root)).toBe("error");
    expect(seen.at(-1)).toEqual(['submit={"amount":5}', "@800"]);
    click(root, '[data-run="submits"]');
    expect(current(root)).toBe("paying");
    expect(seen.at(-1)).toEqual(['submit={"amount":5}']);
  });

  test("a run with no steps resets to the initial state", () => {
    const root = mountRuns();
    sendSubmit(root);
    click(root, '[data-run="empty"]');
    expect(current(root)).toBe("idle");
  });

  test("a run stops at the first step that errors", () => {
    const root = mountRuns();
    click(root, '[data-run="breaks"]');
    expect(current(root)).toBe("idle");
    expect(root.textContent).toContain("unknown event nope");
  });

  function mountRun(options: { run: string; steps?: string[]; driven?: boolean }) {
    const root = document.createElement("div");
    const seen: unknown[] = [];
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRuns] },
      {
        ...(options.driven === false ? {} : { driver: driver() }),
        run: options.run,
        ...(options.steps === undefined ? {} : { steps: options.steps }),
        onNavigate: (where) => seen.push(where),
      },
    );
    return { root, seen };
  }

  test("run= opens on a run's end state without navigating on mount", () => {
    const { root, seen } = mountRun({ run: "pays and times out" });
    expect(current(root)).toBe("error");
    expect(seen).toEqual([]);
  });

  test("run= wins over steps", () => {
    const { root } = mountRun({ run: "submits", steps: ["@800"] });
    expect(current(root)).toBe("paying");
  });

  test("an unknown run opens the start with a notice that the next step clears", () => {
    const { root } = mountRun({ run: "nope" });
    expect(current(root)).toBe("idle");
    const notice = root.querySelector("[data-run-missing]")?.textContent ?? "";
    expect(notice).toContain('No run named "nope"');
    expect(notice).toContain("submits");
    sendSubmit(root);
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });

  test("an unknown run in a machine without runs says so", () => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      { driver: driver(), run: "x" },
    );
    expect(root.querySelector("[data-run-missing]")?.textContent).toBe(
      'No run named "x" in checkout; it has no recorded runs.',
    );
  });

  test("a run without a driver says it replays only live", () => {
    const { root } = mountRun({ run: "submits", driven: false });
    expect(root.querySelector("[data-run-missing]")?.textContent).toContain(
      "replays only when checkout runs live",
    );
  });

  test("clicking a run reports its name to onNavigate", () => {
    const seen: Array<{ run?: string }> = [];
    const root = mountRuns((where) => seen.push(where));
    click(root, '[data-run="submits"]');
    expect(seen.at(-1)?.run).toBe("submits");
  });

  test("a run name from the URL is shown as text, not markup", () => {
    const { root } = mountRun({ run: "<b>x</b>" });
    expect(root.querySelector("[data-run-missing] b")).toBeNull();
    expect(root.querySelector("[data-run-missing]")?.textContent).toContain("<b>x</b>");
  });

  test("switching machine clears the run notice", () => {
    const other: VizMachine = { ...checkout, id: "other" };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRuns, other] },
      { run: "nope", machine: withRuns.id },
    );
    expect(root.querySelector("[data-run-missing]")).not.toBeNull();
    const picker = root.querySelector("select");
    if (picker === null) throw new Error("no machine picker");
    picker.value = "other";
    picker.dispatchEvent(new Event("change"));
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });

  test("a machine without runs shows no Runs section", () => {
    const { root } = mount();
    expect(root.querySelector("[data-runs]")).toBeNull();
  });
});

describe("live step encoding", () => {
  test("round-trips events, payloads and advances", () => {
    const steps: VizStep[] = [
      { kind: "event", event: "go", payload: null },
      { kind: "event", event: "pay", payload: { a: [1, "x=y"], b: null } },
      { kind: "advance", ms: 0 },
      { kind: "advance", ms: 12.5 },
    ];
    expect(decodeLiveSteps(steps.map(encodeLiveStep))).toEqual(steps);
  });

  test("decoding stops at the first bad step", () => {
    expect(decodeLiveSteps(["go", "@-1", "stop"])).toEqual([
      { kind: "event", event: "go", payload: null },
    ]);
    expect(decodeLiveSteps(["a={bad", "go"])).toEqual([]);
    expect(decodeLiveSteps(["@", "=1"])).toEqual([]);
  });

  test("samples skip null payloads and other events", () => {
    expect(payloadSamples(checkout, "paymentTimeout")).toEqual([]);
    expect(payloadSamples(checkout, "submit")).toEqual([{ amount: 5 }, { amount: 9 }]);
  });
});

describe("context highlight", () => {
  const marked = (root: HTMLElement) =>
    [...root.querySelectorAll("[data-live-context] [data-context-changed]")].map((node) =>
      node.textContent?.trim(),
    );

  test("nothing is marked before a step, the changed lines after", () => {
    const { root } = mount();
    expect(marked(root)).toEqual([]);
    sendSubmit(root, '{"amount":42}');
    expect(marked(root)).toEqual(['"amount": 42']);
  });

  test("Back highlights against the step before", () => {
    const { root } = mount({ steps: ['submit={"amount":42}', "@800"] });
    expect(marked(root)).toEqual([]);
    click(root, '[data-explore-action="back"]');
    expect(marked(root)).toEqual(['"amount": 42']);
  });
});

describe("field forms and the context table", () => {
  const fieldsMachine: VizMachine = {
    ...checkout,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [
          {
            name: "validFor",
            type: '"10m" | "1h"',
            optional: false,
            doc: "How long it works.",
            input: "choice",
            choices: ["10m", "1h"],
            sample: "10m",
          },
          {
            name: "note",
            type: "string",
            optional: true,
            doc: null,
            input: "text",
            choices: [],
            sample: "sample",
          },
          {
            name: "flags",
            type: "{ a: boolean }",
            optional: true,
            doc: null,
            input: "json",
            choices: [],
            sample: { a: true },
          },
        ],
      },
      { id: "ping", internal: false, doc: null, payload: null },
    ],
    context: [
      {
        name: "amount",
        type: "number",
        optional: false,
        doc: "What is owed.",
        input: "number",
        choices: [],
        sample: 1,
      },
    ],
    fuzz: null,
  };

  function mountFields(machine: VizMachine = fieldsMachine, held: VizJson = null) {
    const root = document.createElement("div");
    const live = driver(held);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver: live });
    return { root, live };
  }
  const field = (root: HTMLElement, name: string) =>
    root.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-field="${name}"]`);

  test("the note is present when live and absent without a driver", () => {
    expect(mountFields().root.querySelector("[data-live-note]")).not.toBeNull();
    const root = document.createElement("div");
    mountViewer(root, {
      schemaVersion: VIZ_SCHEMA_VERSION,
      machines: [fieldsMachine],
    });
    expect(root.querySelector("[data-live-note]")).toBeNull();
  });

  test("a form has one control per field, prefilled", () => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    expect(root.querySelectorAll("[data-field]").length).toBe(3);
    expect(pressedChoice(root, "validFor")).toBe('"10m"');
    expect(field(root, "flags")?.value).toBe("");
  });

  test("optional fields left empty are left out; a typed json field is parsed", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    const flags = field(root, "flags");
    if (flags) flags.value = '{"a":false}';
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      {
        kind: "event",
        event: "submit",
        payload: { validFor: "10m", flags: { a: false } },
      },
    ]);
  });

  test("bad json in a json field sends nothing and names the field", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    const flags = field(root, "flags");
    if (flags) flags.value = "{";
    click(root, '[data-payload-send="submit"]');
    expect(live.log).toEqual([]);
    expect(root.querySelector(".explore-payload [role=alert]")?.textContent).toBe(
      "Not sent: flags is not valid JSON.",
    );
  });

  test("an event with no payload fields and no samples sends at once", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="ping"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "ping", payload: null }]);
    expect(root.querySelector('[data-send-custom="ping"]')).not.toBeNull();
  });

  const fillMachine: VizMachine = {
    ...fieldsMachine,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [
          {
            name: "code",
            type: "string",
            optional: false,
            doc: null,
            input: "text",
            choices: [],
            sample: "sample",
          },
          {
            name: "validFor",
            type: '"10m" | "1h"',
            optional: false,
            doc: null,
            input: "choice",
            choices: ["10m", "1h"],
            sample: "10m",
          },
        ],
      },
    ],
  };
  const fillFrom = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[role=group][aria-label="Values from"]');
  const fillButtons = (root: HTMLElement) =>
    [...(fillFrom(root)?.querySelectorAll("button") ?? [])].map((each) => each.textContent);
  const pressedFill = (root: HTMLElement) =>
    fillFrom(root)?.querySelector("[aria-pressed=true]")?.textContent;
  const pressFill = (root: HTMLElement, label: string) =>
    click(root, `[data-fill-from="${label}"]`);

  test("the form opens with what a click would send, and Context refills from the state's payload", () => {
    const { root, live } = mountFields(fillMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    expect(fillButtons(root)).toEqual(["Example", "Context"]);
    expect(field(root, "code")?.value).toBe("sample");
    expect(pressedFill(root)).toBe("Example");
    pressFill(root, "Context");
    expect(field(root, "code")?.value).toBe("c1");
    expect(pressedFill(root)).toBe("Context");
    expect(fillFrom(root)?.querySelector("[data-fill-from=Context]")?.getAttribute("title")).toBe(
      "idle",
    );
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      {
        kind: "event",
        event: "submit",
        payload: { code: "c1", validFor: "10m" },
      },
    ]);
  });

  test("pressing Example resets the fields", () => {
    const { root } = mountFields(fuzzedMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    pressFill(root, "Context");
    expect(field(root, "code")?.value).toBe("c1");
    pressFill(root, "Example");
    expect(field(root, "code")?.value).toBe("sample");
    expect(pressedFill(root)).toBe("Example");
  });

  const fuzzedMachine: VizMachine = {
    ...fillMachine,
    fuzz: {
      seed: 1,
      iterations: 1,
      corpus: [
        {
          steps: [
            { kind: "event", event: "submit", payload: { code: "zz", validFor: "1h" } },
            { kind: "event", event: "submit", payload: { code: "", validFor: "3d" } },
          ],
          discovered: [],
        },
      ],
      errors: [],
      failedExpectations: [],
      expectations: [],
    },
  };
  const choose = (root: HTMLElement, name: string, value: string) =>
    field(root, name)
      ?.querySelector<HTMLButtonElement>(`button[data-choice='${JSON.stringify(value)}']`)
      ?.click();
  const pressedChoice = (root: HTMLElement, name: string) =>
    field(root, name)?.querySelector("[aria-pressed=true]")?.getAttribute("data-choice");
  const alertText = (root: HTMLElement) =>
    root.querySelector(".payload-actions [role=alert]")?.textContent;

  test("a click would send the field's example, so the form opens on it with Example pressed", () => {
    const { root, live } = mountFields(fuzzedMachine, null);
    click(root, '[data-send="submit"]');
    expect(fillButtons(root)).toEqual(["Fuzz 1", "Example"]);
    expect(pressedFill(root)).toBe("Example");
    expect(field(root, "code")?.value).toBe("sample");
    expect(pressedChoice(root, "validFor")).toBe('"10m"');
    pressFill(root, "Fuzz 1");
    expect(field(root, "code")?.value).toBe("zz");
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { code: "zz", validFor: "1h" } },
    ]);
  });

  test("Last sent comes first, and Context follows the type's examples", () => {
    const { root } = mountFields(fuzzedMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    pressFill(root, "Context");
    click(root, '[data-payload-send="submit"]');
    click(root, '[data-send="submit"]');
    expect(fillButtons(root)).toEqual(["Last sent", "Fuzz 1", "Example", "Context"]);
    expect(pressedFill(root)).toBe("Last sent");
  });

  test("the button you press stays pressed when another choice holds the same values", () => {
    const { root } = mountFields(fuzzedMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    pressFill(root, "Context");
    click(root, '[data-payload-send="submit"]');
    click(root, '[data-send="submit"]');
    expect(pressedFill(root)).toBe("Last sent");
    pressFill(root, "Context");
    expect(field(root, "code")?.value).toBe("c1");
    expect(pressedFill(root)).toBe("Context");
  });

  test("editing a control moves the pressed Values from button off", () => {
    const { root } = mountFields(fuzzedMachine, null);
    click(root, '[data-send="submit"]');
    choose(root, "validFor", "1h");
    expect(pressedFill(root)).toBeUndefined();
  });

  test("a choice field of four or fewer options is a button row and sends the pressed one", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    const row = field(root, "validFor");
    expect(row?.tagName).toBe("DIV");
    expect([...(row?.querySelectorAll("button") ?? [])].map((each) => each.textContent)).toEqual([
      "10m",
      "1h",
    ]);
    expect(pressedChoice(root, "validFor")).toBe('"10m"');
    choose(root, "validFor", "1h");
    expect(pressedChoice(root, "validFor")).toBe('"1h"');
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { validFor: "1h" } }]);
  });

  test("an optional choice starts on (not set) and is left out", () => {
    const { root, live } = mountFields(optionalChoiceMachine, null);
    click(root, '[data-send="submit"]');
    expect(pressedChoice(root, "tag")).toBe("");
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { size: "s" } }]);
    click(root, '[data-send="submit"]');
    choose(root, "tag", "b");
    click(root, '[data-payload-send="submit"]');
    expect(live.log[1]?.at(-1)).toEqual({
      kind: "event",
      event: "submit",
      payload: { tag: "b", size: "s" },
    });
  });

  test("a choice field with exactly four options is a button row", () => {
    const { root } = mountFields(sizedMachine(["a", "b", "c", "d"], false));
    click(root, '[data-send="submit"]');
    expect(field(root, "pick")?.tagName).toBe("DIV");
  });

  test("an optional choice with four choices has five options and is a select", () => {
    const { root } = mountFields(sizedMachine(["a", "b", "c", "d"], true));
    click(root, '[data-send="submit"]');
    expect(field(root, "pick")?.tagName).toBe("SELECT");
  });

  test("typing in a text field moves the pressed Values from button off", () => {
    const { root } = mountFields(fuzzedMachine, null);
    click(root, '[data-send="submit"]');
    expect(pressedFill(root)).toBe("Example");
    const code = field(root, "code");
    if (code) code.value = "typed";
    code?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(pressedFill(root)).toBeUndefined();
  });

  test("a source that covers some fields resets the others", () => {
    const { root } = mountFields(fillMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    choose(root, "validFor", "1h");
    pressFill(root, "Context");
    expect(field(root, "code")?.value).toBe("c1");
    expect(pressedChoice(root, "validFor")).toBe('"10m"');
    expect(pressedFill(root)).toBe("Context");
    choose(root, "validFor", "10m");
    expect(pressedFill(root)).toBe("Context");
  });

  test("a partial source is pressed only when the other fields are at their reset", () => {
    const fuzzedOptional: VizMachine = {
      ...optionalChoiceMachine,
      fuzz: {
        ...fuzzedMachine.fuzz!,
        corpus: [
          {
            steps: [{ kind: "event", event: "submit", payload: { tag: "b", size: "m" } }],
            discovered: [],
          },
        ],
      },
    };
    const { root, live } = mountFields(fuzzedOptional, null);
    click(root, '[data-send="submit"]');
    click(root, '[data-field="tag"] [data-choice=""]');
    const size = field(root, "size");
    if (size) size.value = JSON.stringify("s");
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { size: "s" } }]);
    click(root, '[data-send="submit"]');
    expect(pressedChoice(root, "tag")).toBe('"b"');
    expect(pressedFill(root)).not.toBe("Last sent");
    pressFill(root, "Last sent");
    expect(pressedChoice(root, "tag")).toBe("");
    expect(pressedFill(root)).toBe("Last sent");
    pressFill(root, "Last sent");
    expect(pressedChoice(root, "tag")).toBe("");
    expect(pressedFill(root)).toBe("Last sent");
  });

  test("a choice field of five options stays a select", () => {
    const { root, live } = mountFields(optionalChoiceMachine, null);
    click(root, '[data-send="submit"]');
    const many = field(root, "size");
    expect(many?.tagName).toBe("SELECT");
    if (many) many.value = '"l"';
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { size: "l" } }]);
  });

  test("the form heading is the event name and there is no JSON mode", () => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    expect(root.querySelector(".payload-title")?.textContent).toBe("submit");
    expect(root.querySelector("[data-payload-as-json]")).toBeNull();
    expect(root.querySelector("[data-payload-json]")).toBeNull();
  });

  const choiceField = (name: string, optional: boolean, choices: string[]): VizField => ({
    name,
    type: choices.map((each) => JSON.stringify(each)).join(" | "),
    optional,
    doc: null,
    input: "choice",
    choices,
    sample: choices[0] ?? "",
  });
  const sizedMachine = (choices: string[], optional: boolean): VizMachine => ({
    ...fieldsMachine,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [choiceField("pick", optional, choices)],
      },
    ],
  });
  const optionalChoiceMachine: VizMachine = {
    ...fieldsMachine,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [
          choiceField("tag", true, ["a", "b"]),
          choiceField("size", false, ["s", "m", "l", "xl", "xxl"]),
        ],
      },
    ],
  };

  test("a bad field focuses it without scrolling", () => {
    const { root } = mountFields();
    document.body.append(root);
    click(root, '[data-send="submit"]');
    const flags = field(root, "flags");
    if (flags) flags.value = "{oops";
    const spy = vi.spyOn(HTMLElement.prototype, "focus");
    click(root, '[data-payload-send="submit"]');
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
    spy.mockRestore();
    root.remove();
  });

  test("a bad field value focuses that field", () => {
    const { root, live } = mountFields();
    document.body.append(root);
    click(root, '[data-send="submit"]');
    const flags = field(root, "flags");
    if (flags) flags.value = "{oops";
    click(root, '[data-payload-send="submit"]');
    expect(live.log).toEqual([]);
    expect(document.activeElement).toBe(flags);
    root.remove();
  });

  test("a missing required field puts the alert in the actions row and focuses the field", () => {
    const { root, live } = mountFields(requiredMachine, null);
    document.body.append(root);
    click(root, '[data-send="submit"]');
    const amount = field(root, "amount");
    if (amount) amount.value = "";
    click(root, '[data-payload-send="submit"]');
    expect(live.log).toEqual([]);
    expect(alertText(root)).toBe("Not sent: amount is required.");
    expect(document.activeElement).toBe(amount);
    root.remove();
  });

  test("no matches means no Values from", () => {
    const { root } = mountFields(fillMachine, null);
    click(root, '[data-send="submit"]');
    expect(fillFrom(root)).toBeNull();
    expect(field(root, "code")?.value).toBe("sample");
  });

  test("the Context tab lists each declared field with its meaning and value", () => {
    const { root } = mountFields();
    click(root, '[data-send="ping"]');
    const row = root.querySelector('[data-context-field="amount"]');
    expect(row?.textContent).toContain("What is owed.");
    expect(row?.textContent).toContain("not set");
    expect(root.querySelector("[data-context-changed]")).toBeNull();
  });

  const requiredMachine: VizMachine = {
    ...fieldsMachine,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [
          {
            name: "amount",
            type: "number",
            optional: false,
            doc: null,
            input: "number",
            choices: [],
            sample: 1,
          },
          {
            name: "label",
            type: "string",
            optional: false,
            doc: null,
            input: "text",
            choices: [],
            sample: "hi",
          },
        ],
      },
    ],
  };

  test("a number field sends a number and a required text field sends its string", () => {
    const { root, live } = mountFields(requiredMachine);
    click(root, '[data-send="submit"]');
    const amount = field(root, "amount");
    if (amount) amount.value = "7.5";
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 7.5, label: "hi" } },
    ]);
  });

  test("a required text field cleared sends an empty string", () => {
    const { root, live } = mountFields(requiredMachine);
    click(root, '[data-send="submit"]');
    const label = field(root, "label");
    if (label) label.value = "";
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 1, label: "" } },
    ]);
  });

  test("a cleared or non-numeric required number sends nothing and names the field", () => {
    for (const value of ["", "abc"]) {
      const { root, live } = mountFields(requiredMachine);
      click(root, '[data-send="submit"]');
      const amount = field(root, "amount");
      if (amount) amount.value = value;
      click(root, '[data-payload-send="submit"]');
      expect(live.log).toEqual([]);
      expect(root.querySelector(".explore-payload [role=alert]")?.textContent).toBe(
        "Not sent: amount is required.",
      );
    }
  });

  test("a cleared required json field sends nothing and names the field", () => {
    const jsonMachine: VizMachine = {
      ...requiredMachine,
      events: [
        {
          id: "submit",
          internal: false,
          doc: null,
          payload: [
            {
              name: "flags",
              type: "{ a: boolean }",
              optional: false,
              doc: null,
              input: "json",
              choices: [],
              sample: { a: true },
            },
          ],
        },
      ],
    };
    const { root, live } = mountFields(jsonMachine);
    click(root, '[data-send="submit"]');
    const flags = field(root, "flags");
    if (flags) flags.value = "";
    click(root, '[data-payload-send="submit"]');
    expect(live.log).toEqual([]);
    expect(root.querySelector(".explore-payload [role=alert]")?.textContent).toBe(
      "Not sent: flags is required.",
    );
  });

  test("the context table marks a field the last step changed", () => {
    const { root } = mountFields(requiredMachine);
    click(root, '[data-send="submit"]');
    const amount = field(root, "amount");
    if (amount) amount.value = "7";
    click(root, '[data-payload-send="submit"]');
    const row = root.querySelector('[data-context-field="amount"]');
    expect(row?.hasAttribute("data-context-changed")).toBe(true);
    expect(row?.textContent).toContain("7");
  });

  test("a context without declared fields falls back to the JSON view", () => {
    const { root } = mountFields({ ...fieldsMachine, context: null });
    expect(root.querySelector("[data-context-fields]")).toBeNull();
    expect(root.querySelector("[data-live-context] pre")).not.toBeNull();
  });
});

describe("what ran", () => {
  const branching: VizMachine = {
    ...checkout,
    edges: [
      {
        ...edge("idle", "submit", "paying"),
        explanation: {
          status: "analyzed",
          location: { file: "m.ts", line: 1, column: 1 },
          registration: "on",
          branches: [
            {
              conditions: ["payload.amount > 5"],
              target: { kind: "state", state: "paying" },
            },
            { conditions: ["!(payload.amount > 5)"], target: { kind: "stay" } },
          ],
          payloadReads: [],
          contextReads: [],
          contextWrites: [],
          readsActorState: false,
          comparisons: [],
          literals: [],
        },
      },
    ],
  };
  const mountWith = (machine: VizMachine, live: VizDriver, routes?: VizOutputRoutes) => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
      { driver: live, ...(routes === undefined ? {} : { routes }) },
    );
    return root;
  };
  const text = (root: HTMLElement, hook: string) =>
    root.querySelector(`[data-live-${hook}]`)?.textContent;
  const submit = {
    kind: "event",
    event: "submit",
    payload: { amount: 9 },
  } as const;

  function stepped(
    entry: Partial<VizLiveState["last"] & object>,
    after: VizLiveState["after"] = [],
  ) {
    const base: VizLiveStep = {
      from: "idle",
      event: "submit",
      to: "paying",
      outcome: "transition",
      effects: [],
      sent: [],
      context: { amount: 9 },
      error: null,
    };
    const last: VizLiveStep = { ...base, ...entry };
    let onChange: (state: VizLiveState) => void = () => undefined;
    const live: VizDriver = {
      reset: () => ({
        state: "idle",
        steps: [],
        last: null,
        after: [],
        timers: [],
        context: {},
        payload: null,
        regions: {},
        children: [],
        effectMode: "real",
        waiting: [],
      }),
      step: (step) => ({
        state: last.to,
        steps: [step],
        last,
        after,
        timers: [],
        context: last.context,
        payload: null,
        regions: {},
        children: [],
        effectMode: "real",
        waiting: [],
      }),
      listen: (callback) => {
        onChange = callback;
      },
    };
    return { live, push: (state: VizLiveState) => onChange(state) };
  }

  test("Because shows the condition for a transition and a stay", () => {
    const move = mountWith(branching, stepped({}).live);
    click(move, '[data-send="submit"]');
    click(move, '[data-payload-send="submit"]');
    expect(text(move, "outcome")).toBe("submit: idle → paying");
    expect(text(move, "because")).toBe("Because: payload.amount > 5");

    const stay = mountWith(branching, stepped({ to: "idle", outcome: "stay", context: {} }).live);
    click(stay, '[data-send="submit"]');
    click(stay, '[data-payload-send="submit"]');
    expect(text(stay, "outcome")).toBe("submit: handled in idle, stays");
    expect(text(stay, "because")).toBe("Because: !(payload.amount > 5)");
  });

  test("Sent out names each output, with where the app takes it when the page knows", () => {
    const routes: VizOutputRoutes = {
      [branching.id]: { openAlbum: [{ to: "router", event: "NAVIGATED", at: "a.ts:72" }] },
    };
    const send = (root: HTMLElement) => {
      click(root, '[data-send="submit"]');
      click(root, '[data-payload-send="submit"]');
    };
    const routed = mountWith(branching, stepped({ sent: ["openAlbum"] }).live, routes);
    send(routed);
    expect(text(routed, "sent")).toBe("Sent out: openAlbum → router takes NAVIGATED (a.ts:72)");

    const bare = mountWith(branching, stepped({ sent: ["openAlbum"] }).live);
    send(bare);
    expect(text(bare, "sent")).toBe("Sent out: openAlbum");

    const several = mountWith(
      branching,
      stepped({ sent: ["openAlbum", "ANSWER_SENT"] }).live,
      routes,
    );
    send(several);
    expect(text(several, "sent")).toBe(
      "Sent out: openAlbum → router takes NAVIGATED (a.ts:72); ANSWER_SENT",
    );

    const quiet = mountWith(branching, stepped({}).live, routes);
    send(quiet);
    expect(quiet.querySelector("[data-live-sent]")).toBeNull();
  });

  test("Because is absent when every branch shares a target", () => {
    const plain: VizMachine = {
      ...branching,
      edges: branching.edges.map((candidate) =>
        candidate.explanation?.status === "analyzed"
          ? {
              ...candidate,
              explanation: {
                ...candidate.explanation,
                branches: [
                  {
                    conditions: ["a"],
                    target: { kind: "state", state: "paying" },
                  },
                  {
                    conditions: ["!a"],
                    target: { kind: "state", state: "paying" },
                  },
                ],
              },
            }
          : candidate,
      ),
    };
    const root = mountWith(plain, stepped({}).live);
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-send="submit"]');
    expect(root.querySelector("[data-live-because]")).toBeNull();
  });

  test("Changed names the keys and Effects started names the effects", () => {
    const root = mountWith(
      branching,
      stepped({ effects: ["charge"], context: { amount: 9, tag: "x" } }).live,
    );
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-send="submit"]');
    expect(text(root, "changed")).toBe("Changed: amount, tag");
    expect(text(root, "effects")).toBe("Effects started: charge");
  });

  test("an async result renders without another click", () => {
    const { live, push } = stepped({});
    const root = mountWith(branching, live);
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-send="submit"]');
    expect(root.querySelector("[data-live-after]")).toBeNull();
    push({
      state: "error",
      steps: [submit],
      last: {
        from: "idle",
        event: "submit",
        to: "paying",
        outcome: "transition",
        effects: [],
        sent: [],
        context: { amount: 9 },
        error: null,
      },
      after: [
        {
          from: "paying",
          event: "paymentTimeout",
          to: "error",
          outcome: "transition",
          effects: [],
          sent: [],
          context: { amount: 9, failed: true },
          error: null,
        },
      ],
      timers: [],
      context: { amount: 9, failed: true },
      payload: null,
      regions: {},
      children: [],
      effectMode: "real",
      waiting: [],
    });
    const after = root.querySelector("[data-live-after]");
    expect(after?.textContent).toContain("Then paymentTimeout came back");
    expect(after?.textContent).toContain("paymentTimeout: paying → error");
    expect(after?.textContent).toContain("Changed: failed");
  });

  test("an ignored event says nothing ran", () => {
    const root = mountWith(branching, stepped({ to: "idle", outcome: "ignored" }).live);
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-send="submit"]');
    expect(text(root, "outcome")).toBe("No handler for submit in idle. Nothing ran.");
  });
});

describe("live effect reports", () => {
  const withDoc = (from: string, event: string, to: string, doc: string | null): VizEdge => ({
    ...edge(from, event, to),
    doc,
  });
  const fetcher: VizMachine = {
    ...checkout,
    id: "fetcher",
    initial: "waiting",
    states: [
      state("waiting", { initial: true }),
      {
        ...state("fetching"),
        effects: [
          {
            name: "fetchList",
            sends: ["listFetched", "fetchFailed", "fetchGone"],
          },
        ],
      },
      state("couldNotFetch"),
    ],
    events: [
      { id: "start", internal: false, doc: null, payload: null },
      { id: "listFetched", internal: true, doc: null, payload: null },
      { id: "fetchFailed", internal: true, doc: null, payload: null },
      { id: "fetchGone", internal: true, doc: null, payload: null },
    ],
    edges: [
      edge("waiting", "start", "fetching"),
      withDoc("fetching", "listFetched", "waiting", "The list is shown."),
      withDoc(
        "fetching",
        "fetchFailed",
        "couldNotFetch",
        "Fetching failed: the person can try again.",
      ),
    ],
    fuzz: {
      ...checkout.fuzz,
      seed: 1,
      iterations: 1,
      errors: [],
      failedExpectations: [],
      expectations: [],
      corpus: [],
    },
  };
  const next: Record<string, Record<string, string>> = {
    waiting: { start: "fetching" },
    fetching: { listFetched: "waiting", fetchFailed: "couldNotFetch" },
  };
  function fetchDriver(mode: "held" | "real" = "real", held = ["fetchList"]): VizDriver {
    const run = (steps: VizStep[]): VizLiveState => {
      let current = "waiting";
      for (const step of steps) {
        if (step.kind === "event") current = next[current]?.[step.event] ?? current;
      }
      return {
        state: current,
        steps,
        last: null,
        after: [],
        timers: [],
        context: null,
        payload: null,
        regions: {},
        effectMode: mode,
        waiting: mode === "held" && current === "fetching" ? held : [],
        children: [],
      };
    };
    const done: VizStep[] = [];
    return {
      reset: () => {
        done.length = 0;
        return run([]);
      },
      step: (step) => {
        done.push(step);
        return run([...done]);
      },
    };
  }
  function mountFetcher(
    options: {
      mode?: "held" | "real";
      machine?: VizMachine;
      held?: string[];
    } = {},
  ) {
    const root = document.createElement("div");
    mountViewer(
      root,
      {
        schemaVersion: VIZ_SCHEMA_VERSION,
        machines: [options.machine ?? fetcher],
      },
      { driver: fetchDriver(options.mode, options.held) },
    );
    click(root, '[data-send="start"]');
    return root;
  }
  const events = (root: HTMLElement, group: string) =>
    [...root.querySelectorAll(`[data-group="${group}"] [data-send]`)].map((each) =>
      each.getAttribute("data-send"),
    );

  test("lists what the running effect reports, with where each comes from", () => {
    const root = mountFetcher();
    expect(events(root, "effect")).toEqual(["fetchFailed", "listFetched"]);
    const from = [...root.querySelectorAll('[data-group="effect"] [data-sent-by]')].map((each) =>
      each.getAttribute("data-sent-by"),
    );
    expect(from).toEqual(["fetchList", "fetchList"]);
  });

  test("a report shows its handler's doc", () => {
    const root = mountFetcher();
    expect(root.querySelector('[data-send-item="fetchFailed"]')?.textContent).toContain(
      "Fetching failed: the person can try again.",
    );
  });

  test("picking the failure moves down the error path and Back undoes it", () => {
    const root = mountFetcher();
    click(root, '[data-send="fetchFailed"]');
    expect(current(root)).toBe("couldNotFetch");
    click(root, '[data-explore-action="back"]');
    expect(current(root)).toBe("fetching");
  });

  test("inputs are grouped apart and marked ignored", () => {
    const root = mountFetcher();
    expect(
      root.querySelector('[data-group="input"] [data-send-item="start"]')?.textContent,
    ).toContain(" ignored in fetching");
  });

  test("a handled internal event no effect sends sits under Other internal events", () => {
    const root = document.createElement("div");
    const machine: VizMachine = {
      ...fetcher,
      events: [...fetcher.events, { id: "poke", internal: true, doc: null, payload: null }],
      edges: [...fetcher.edges, edge("fetching", "poke", "waiting")],
    };
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
      { driver: fetchDriver() },
    );
    click(root, '[data-send="start"]');
    expect(events(root, "internal")).toEqual(["poke"]);
    expect(root.querySelector('[data-group="internal"]')?.previousElementSibling?.textContent).toBe(
      "Other internal events",
    );
  });

  test("the old single list is gone", () => {
    const root = mountFetcher();
    expect(root.querySelector('[data-group="live"]')).toBeNull();
    expect([...root.querySelectorAll("h3")].map((each) => each.textContent)).not.toContain(
      "Send an event",
    );
  });

  describe("held", () => {
    const waitingOn = (root: HTMLElement) =>
      root.querySelector<HTMLElement>('.explore-now [data-waiting-on="fetchList"]');
    const withEffect = (sends: string[] | null): VizMachine => ({
      ...fetcher,
      states: fetcher.states.map((each) =>
        each.id === "fetching" ? { ...each, effects: [{ name: "fetchList", sends }] } : each,
      ),
    });

    test("the live section carries the effect mode and no explaining paragraph", () => {
      const root = mountFetcher({ mode: "held" });
      const section = root.querySelector("section.explore");
      expect(section?.hasAttribute("data-live-note")).toBe(true);
      expect(section?.getAttribute("data-effect-mode")).toBe("held");
      expect(root.querySelector(".explore-note")).toBeNull();
      expect(root.querySelector(".explore-waiting")).toBeNull();
    });

    test("the state line says what it waits for and what that reports", () => {
      const root = mountFetcher({ mode: "held" });
      expect(root.querySelector(".explore-now")?.textContent).toBe(
        "In fetching, waiting for fetchList",
      );
      expect(waitingOn(root)?.getAttribute("data-reports")).toBe("listFetched fetchFailed");
    });

    test("its reports are sends in the fold's effect group", () => {
      const root = mountFetcher({ mode: "held" });
      const inGroup = [
        ...root.querySelectorAll('.explore-moves [data-group="effect"] [data-send]'),
      ].map((each) => each.getAttribute("data-send"));
      expect(inGroup).toContain("listFetched");
      expect(inGroup).toContain("fetchFailed");
    });

    test("the outcome does not repeat the effects line", () => {
      const root = mountFetcher({ mode: "held" });
      expect(root.querySelector("[data-live-effects]")).toBeNull();
      expect(root.querySelector(".explore-effects")).toBeNull();
    });

    test("an effect that reports nothing is not named", () => {
      const root = mountFetcher({ mode: "held", machine: withEffect([]) });
      expect(root.querySelector("[data-waiting-on]")).toBeNull();
      expect(root.querySelector(".explore-now")?.textContent).toBe("In fetching");
    });

    test("an effect that does not declare its reports is named with none", () => {
      const root = mountFetcher({ mode: "held", machine: withEffect(null) });
      expect(waitingOn(root)?.getAttribute("data-reports")).toBe("");
      expect(waitingOn(root)?.textContent).toBe("fetchList");
    });

    test("an effect that is not waiting is not named", () => {
      const root = mountFetcher({ mode: "held", held: [] });
      expect(root.querySelector("[data-waiting-on]")).toBeNull();
    });

    test("a held effect in a region is named on the region's line", () => {
      const machine: VizMachine = {
        ...fetcher,
        regions: ["upload"],
        states: [
          state("waiting", { initial: true }),
          {
            ...state("upload.sending"),
            effects: [{ name: "sendPhoto", sends: ["photoSent"] }],
          },
        ],
        events: [{ id: "photoSent", internal: true, doc: null, payload: null }],
        edges: [edge("upload.sending", "photoSent", "upload.sending")],
      };
      const live: VizLiveState = {
        state: "waiting",
        steps: [],
        last: null,
        after: [],
        timers: [],
        context: null,
        payload: null,
        children: [],
        regions: { upload: "upload.sending" },
        effectMode: "held",
        waiting: ["sendPhoto"],
      };
      const root = document.createElement("div");
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
        {
          driver: { reset: () => live, step: () => live },
        },
      );
      const line = root.querySelector('.explore-region-now [data-waiting-on="sendPhoto"]');
      expect(line?.getAttribute("data-reports")).toBe("photoSent");
      expect(
        root.querySelector(".explore-now:not(.explore-region-now) [data-waiting-on]"),
      ).toBeNull();
      expect(root.querySelector('[data-send="photoSent"]')).not.toBeNull();
    });

    test("two waiting effects are joined with a comma", () => {
      const machine: VizMachine = {
        ...fetcher,
        states: fetcher.states.map((each) =>
          each.id === "fetching"
            ? {
                ...each,
                effects: [
                  { name: "fetchList", sends: ["listFetched"] },
                  { name: "fetchMore", sends: ["fetchFailed"] },
                ],
              }
            : each,
        ),
      };
      const root = mountFetcher({ mode: "held", machine, held: ["fetchList", "fetchMore"] });
      expect(root.querySelector(".explore-now")?.textContent).toBe(
        "In fetching, waiting for fetchList, fetchMore",
      );
    });

    test("a final root with a held effect does not say it waits", () => {
      const machine: VizMachine = {
        ...fetcher,
        states: fetcher.states.map((each) =>
          each.id === "fetching" ? { ...each, final: true } : each,
        ),
      };
      const root = mountFetcher({ mode: "held", machine });
      expect(root.querySelector(".explore-now")?.textContent).toBe("In fetching (final)");
      expect(root.querySelector("[data-waiting-on]")).toBeNull();
      expect(root.querySelector("details[data-events]")).toBeNull();
      expect(root.querySelector("[data-advance]")).toBeNull();
    });

    test("a final region with a held effect does not say it waits", () => {
      const machine: VizMachine = {
        ...fetcher,
        regions: ["upload"],
        states: [
          state("waiting", { initial: true }),
          {
            ...state("upload.sending"),
            final: true,
            effects: [{ name: "sendPhoto", sends: ["photoSent"] }],
          },
        ],
        events: [{ id: "photoSent", internal: true, doc: null, payload: null }],
        edges: [],
      };
      const live: VizLiveState = {
        state: "waiting",
        steps: [],
        last: null,
        after: [],
        timers: [],
        context: null,
        payload: null,
        children: [],
        regions: { upload: "upload.sending" },
        effectMode: "held",
        waiting: ["sendPhoto"],
      };
      const root = document.createElement("div");
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
        { driver: { reset: () => live, step: () => live } },
      );
      expect(root.querySelector(".explore-region-now")?.textContent).toBe(
        "upload: in sending (final)",
      );
      expect(root.querySelector("[data-waiting-on]")).toBeNull();
    });

    test("picking a report moves on and Back returns to waiting", () => {
      const root = mountFetcher({ mode: "held" });
      click(root, '[data-send="fetchFailed"]');
      expect(current(root)).toBe("couldNotFetch");
      expect(waitingOn(root)).toBeNull();
      click(root, '[data-explore-action="back"]');
      expect(waitingOn(root)).not.toBeNull();
    });
  });

  describe("the Events and time fold", () => {
    const fold = (root: HTMLElement) =>
      root.querySelector<HTMLDetailsElement>("details[data-events]");

    test("at rest the Step tab shows the state line and a closed Events and time fold", () => {
      const root = mountFetcher();
      expect(fold(root)?.open).toBe(false);
      expect(fold(root)?.querySelector("summary")?.textContent).toBe("Events and time");
      expect(fold(root)?.querySelector("[data-send]")).not.toBeNull();
      expect(fold(root)?.querySelector("[data-advance]")).not.toBeNull();
      expect(root.querySelector(".explore > [data-send]")).toBeNull();
    });

    test("the fold stays open across a step and Back", () => {
      const root = mountFetcher();
      const details = fold(root);
      if (details === null) throw new Error("no fold");
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
      click(root, '[data-send="start"]');
      expect(fold(root)?.open).toBe(true);
      click(root, '[data-explore-action="back"]');
      expect(fold(root)?.open).toBe(true);
    });

    test("a closed fold stays closed across a step", () => {
      const root = mountFetcher();
      click(root, '[data-send="start"]');
      expect(fold(root)?.open).toBe(false);
    });
  });
});

describe("Controls tab, live", () => {
  test("Always ask sits in the Controls tab, not the header", () => {
    const { root } = mount();
    expect(root.querySelector('[data-tab-panel="controls"] [data-always-ask]')).not.toBeNull();
    expect(root.querySelector(".viz-header [data-always-ask]")).toBeNull();
  });

  test("Diagram only hides the changes list and the run notice", () => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      {
        driver: driver(),
        run: "nope",
        changes: {
          machine: "checkout",
          before: { states: ["idle"], arrows: [] },
          onSeen: () => {},
        },
      },
    );
    expect(root.querySelector("section.changes")).not.toBeNull();
    expect(root.querySelector("[data-run-missing]")).not.toBeNull();
    click(root, "[data-diagram-only]");
    expect(root.querySelector("section.changes")).toBeNull();
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });
});
