// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
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

  test("an edge click does not scroll or move focus", () => {
    const { root } = mount();
    const scroll = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => undefined);
    clickEdge(root, "idle-submit-paying");
    clickEdge(root, "paying-paymentTimeout-error");
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

  test("a form has one input per field, prefilled, and sends the changed choice", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    expect(root.querySelectorAll("[data-field]").length).toBe(3);
    expect(field(root, "validFor")?.value).toBe('"10m"');
    expect(field(root, "flags")?.value).toBe("");
    const select = field(root, "validFor");
    if (select) select.value = '"1h"';
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { validFor: "1h" } }]);
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
    root.querySelector<HTMLSelectElement>("select[data-fill-from]");

  test("the form starts filled from the state's payload and says where from", () => {
    const { root, live } = mountFields(fillMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    expect(fillFrom(root)).toBeNull();
    expect(field(root, "code")?.value).toBe("c1");
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      {
        kind: "event",
        event: "submit",
        payload: { code: "c1", validFor: "10m" },
      },
    ]);
  });

  test("choosing the type's samples resets the fields", () => {
    const { root } = mountFields(fuzzedMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    const picker = fillFrom(root);
    if (picker) {
      picker.value = "";
      picker.dispatchEvent(new Event("change"));
    }
    expect(field(root, "code")?.value).toBe("sample");
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
  const optionTexts = (root: HTMLElement) =>
    [...(fillFrom(root)?.options ?? [])].map((each) => each.textContent);
  const asJson = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('[data-payload-as-json="submit"]');
  const jsonBox = (root: HTMLElement) =>
    root.querySelector<HTMLTextAreaElement>('[data-payload-json="submit"]');
  const alertText = (root: HTMLElement) =>
    root.querySelector(".payload-actions [role=alert]")?.textContent;

  test("fuzzed payloads follow the type's examples in Values from", () => {
    const { root, live } = mountFields(fuzzedMachine, null);
    click(root, '[data-send="submit"]');
    expect(optionTexts(root)).toEqual([
      "Examples from the type",
      "fuzz example 1: code zz, validFor 1h",
    ]);
    expect(field(root, "code")?.value).toBe("sample");
    const picker = fillFrom(root);
    if (picker) {
      picker.value = "0";
      picker.dispatchEvent(new Event("change"));
    }
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { code: "zz", validFor: "1h" } },
    ]);
  });

  test("held values stay first and selected, fuzz examples come after the type", () => {
    const { root } = mountFields(fuzzedMachine, { code: "c1" });
    click(root, '[data-send="submit"]');
    expect(optionTexts(root)).toEqual([
      "idle: code c1",
      "Examples from the type",
      "fuzz example 1: code zz, validFor 1h",
    ]);
    expect(fillFrom(root)?.value).toBe("0");
  });

  test("Edit as JSON shows the fields as JSON and sends exactly what is typed", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    expect(root.querySelector("[data-payload-form]")?.getAttribute("data-payload-view")).toBe(
      "json",
    );
    expect(JSON.parse(jsonBox(root)?.value ?? "")).toEqual({ validFor: "10m" });
    const box = jsonBox(root);
    if (box) box.value = '{"anything":[1,2]}';
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { anything: [1, 2] } },
    ]);
  });

  test("Edit as fields refuses extra keys, then returns with the edited values", () => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    const box = jsonBox(root);
    if (box) box.value = '{"validFor":"10m","extra":1,"more":2}';
    click(root, '[data-payload-as-fields="submit"]');
    expect(alertText(root)).toBe(
      "Not fields of submit: extra, more. Remove them to edit as fields.",
    );
    expect(root.querySelector("[data-payload-form]")?.getAttribute("data-payload-view")).toBe(
      "json",
    );
    if (box) box.value = "{nope";
    click(root, '[data-payload-as-fields="submit"]');
    expect(alertText(root)).toBe("This is not valid JSON, so it cannot be shown as fields.");
    if (box) box.value = '{"validFor":"10m","note":"hi"}';
    click(root, '[data-payload-as-fields="submit"]');
    expect(root.querySelector("[data-payload-form]")?.getAttribute("data-payload-view")).toBe(
      "fields",
    );
    expect(field(root, "note")?.value).toBe("hi");
    expect(asJson(root)).not.toBeNull();
  });

  test("invalid JSON in the JSON view sends nothing and says so", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    const box = jsonBox(root);
    if (box) box.value = "{nope";
    click(root, '[data-payload-send="submit"]');
    expect(live.log).toEqual([]);
    expect(alertText(root)).toBe("Not sent: this is not valid JSON.");
  });

  test("an empty JSON box sends a null payload", () => {
    const { root, live } = mountFields();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    const box = jsonBox(root);
    if (box) box.value = "  ";
    click(root, '[data-payload-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: null }]);
  });

  test("a field left empty stays out of the JSON view", () => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    expect(Object.keys(JSON.parse(jsonBox(root)?.value ?? ""))).toEqual(["validFor"]);
  });

  test("text that is not valid JSON survives fields to JSON and back", () => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    const flags = field(root, "flags");
    if (flags) flags.value = "{oops";
    click(root, '[data-payload-as-json="submit"]');
    expect(JSON.parse(jsonBox(root)?.value ?? "")).toEqual({ validFor: "10m", flags: "{oops" });
  });

  test("Edit as fields clears inputs whose key is missing and hides an old alert", () => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    const note = field(root, "note");
    if (note) note.value = "old";
    click(root, '[data-payload-as-json="submit"]');
    const box = jsonBox(root);
    if (box) box.value = "{nope";
    click(root, '[data-payload-as-fields="submit"]');
    expect(alertText(root)).not.toBe("");
    if (box) box.value = '{"validFor":"1h"}';
    click(root, '[data-payload-as-fields="submit"]');
    expect(note?.value).toBe("");
    expect(root.querySelector("[role=alert]")?.hasAttribute("hidden")).toBe(true);
    click(root, '[data-payload-as-json="submit"]');
    expect(root.querySelector("[role=alert]")?.hasAttribute("hidden")).toBe(true);
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

  test("invalid JSON focuses the box in either direction", () => {
    const { root } = mountFields();
    document.body.append(root);
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    const box = jsonBox(root);
    if (box) box.value = "{nope";
    click(root, '[data-payload-send="submit"]');
    expect(document.activeElement).toBe(box);
    (document.activeElement as HTMLElement | null)?.blur();
    click(root, '[data-payload-as-fields="submit"]');
    expect(document.activeElement).toBe(box);
    root.remove();
  });

  test.each(["[1]", "5", '"x"'])("Edit as fields refuses %s as not an object", (text) => {
    const { root } = mountFields();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-as-json="submit"]');
    const box = jsonBox(root);
    if (box) box.value = text;
    click(root, '[data-payload-as-fields="submit"]');
    expect(alertText(root)).toBe(
      "Not fields of submit: not an object. Remove them to edit as fields.",
    );
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
    expect(root.querySelector("[data-context-note]")).not.toBeNull();
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

  test("a report no state handles is flagged", () => {
    const root = mountFetcher();
    expect(root.querySelector('.explore-warning[role="note"]')?.textContent).toContain(
      "No handler in fetching for fetchGone",
    );
  });

  test("inputs are grouped apart and marked ignored", () => {
    const root = mountFetcher();
    expect(
      root.querySelector('[data-group="input"] [data-send-item="start"]')?.textContent,
    ).toContain(" ignored in fetching");
  });

  test("the note says effects run", () => {
    const root = mountFetcher();
    expect(root.querySelector("[data-live-note]")?.textContent).toBe(
      "This machine runs here, in your browser, with its effects. Timers wait until you advance them.",
    );
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
    const waitingBlock = (root: HTMLElement) =>
      root.querySelector('section[data-waiting-on="fetchList"]');
    const withEffect = (sends: string[] | null): VizMachine => ({
      ...fetcher,
      states: fetcher.states.map((each) =>
        each.id === "fetching" ? { ...each, effects: [{ name: "fetchList", sends }] } : each,
      ),
    });

    test("the note says effects do not run", () => {
      const root = mountFetcher({ mode: "held" });
      const note = root.querySelector("[data-live-note]");
      expect(note?.getAttribute("data-effect-mode")).toBe("held");
      expect(note?.textContent).toBe(
        "This machine runs here, in your browser, but its effects do not: when a state starts one, the viz waits and you pick what it reports. Timers wait until you advance them.",
      );
    });

    test("the waiting block comes right after the now section", () => {
      const root = mountFetcher({ mode: "held" });
      const now = root.querySelector(".explore-now");
      expect(now?.nextElementSibling).toBe(waitingBlock(root));
      expect(waitingBlock(root)?.querySelector("h3")?.textContent).toBe("Waiting for fetchList");
    });

    test("its reports are in declared order and are not repeated in the groups", () => {
      const root = mountFetcher({ mode: "held" });
      const inBlock = [...(waitingBlock(root)?.querySelectorAll("[data-send]") ?? [])].map((each) =>
        each.getAttribute("data-send"),
      );
      expect(inBlock).toEqual(["listFetched", "fetchFailed"]);
      expect(root.querySelector('.explore-moves [data-group="effect"]')).toBeNull();
      expect(root.querySelector('.explore-moves [data-send="fetchFailed"]')).toBeNull();
    });

    test("a declared report the state does not handle has text and no button", () => {
      const root = mountFetcher({ mode: "held" });
      const item = waitingBlock(root)?.querySelector('[data-send-item="fetchGone"]');
      expect(item?.hasAttribute("data-unhandled")).toBe(true);
      expect(item?.querySelector("button")).toBeNull();
      expect(item?.textContent).toBe(
        "fetchGone is not handled in fetching. In your app, fetchList sending it puts the machine in its error state.",
      );
    });

    test("the outcome does not repeat the effects line", () => {
      const root = mountFetcher({ mode: "held" });
      expect(root.querySelector("[data-live-effects]")).toBeNull();
      expect(root.querySelector(".explore-effects")).toBeNull();
    });

    test("an effect that reports nothing says so and has no block", () => {
      const root = mountFetcher({ mode: "held", machine: withEffect([]) });
      expect(waitingBlock(root)).toBeNull();
      expect(root.querySelector('[data-held-quiet="fetchList"]')?.textContent).toBe(
        "fetchList did not run. It reports nothing, so there is nothing to answer.",
      );
    });

    test("an effect that does not declare its reports points to the internal events", () => {
      const root = mountFetcher({ mode: "held", machine: withEffect(null) });
      expect(waitingBlock(root)?.querySelector("p")?.textContent).toBe(
        "It did not run, and it does not declare what it reports (sends). Pick its answer under Other internal events.",
      );
      expect(waitingBlock(root)?.querySelector("[data-send]")).toBeNull();
    });

    test("an effect of a later state that is not waiting does not claim it ran for real", () => {
      const root = mountFetcher({ mode: "held", held: [] });
      expect(waitingBlock(root)).toBeNull();
      expect(root.querySelector("[data-ran-for-real]")).toBeNull();
    });

    test("an effect of the initial state that is not waiting ran for real", () => {
      const machine: VizMachine = {
        ...fetcher,
        states: fetcher.states.map((each) =>
          each.id === "waiting" ? { ...each, effects: [{ name: "warmUp", sends: [] }] } : each,
        ),
      };
      const root = document.createElement("div");
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
        {
          driver: fetchDriver("held", []),
        },
      );
      expect(root.querySelector('[data-ran-for-real="warmUp"]')?.textContent).toContain(
        "warmUp ran for real",
      );
    });

    test("a held effect in a region shows a waiting block with its reports", () => {
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
      expect(root.querySelector('section[data-waiting-on="sendPhoto"]')).not.toBeNull();
      expect(
        root.querySelector('[data-waiting-on="sendPhoto"] [data-send="photoSent"]'),
      ).not.toBeNull();
    });

    test("picking a report moves on and Back returns to waiting", () => {
      const root = mountFetcher({ mode: "held" });
      click(root, '[data-waiting-on="fetchList"] [data-send="fetchFailed"]');
      expect(current(root)).toBe("couldNotFetch");
      expect(waitingBlock(root)).toBeNull();
      click(root, '[data-explore-action="back"]');
      expect(waitingBlock(root)).not.toBeNull();
    });
  });
});
