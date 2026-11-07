// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { decodeLiveSteps, encodeLiveStep, payloadSamples } from "../moves.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

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
  },
};

/** A pure function of the step log, like the real driver after reset + replay. */
function driver(): VizDriver & { log: VizStep[][] } {
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
      timers:
        current === "paying" && deadline !== null
          ? [{ id: "t1", ms: 800, deadline, eventName: "paymentTimeout" }]
          : [],
      context,
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

function mount(options: { steps?: string[]; onNavigate?: (w: { steps: string[] }) => void } = {}) {
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

  test("cancel closes the form without sending", () => {
    const { root, live } = mount();
    click(root, '[data-send="submit"]');
    click(root, '[data-payload-cancel="submit"]');
    expect(live.log).toEqual([]);
    expect(root.querySelector("[data-payload-form]")).toBeNull();
  });

  test("clicking an edge that carries a payload opens its form", () => {
    const { root, live } = mount();
    root
      .querySelector('[data-edge-id="idle-submit-paying"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(live.log).toEqual([]);
    expect(
      root.querySelector('.canvas .payload-popover [data-payload-form="submit"]'),
    ).not.toBeNull();
    expect(root.querySelector(".payload-popover")?.getAttribute("aria-label")).toBe(
      "Payload for submit",
    );
  });

  test("the Send list opens the same popover on the diagram, and Escape closes it", () => {
    const { root, live } = mount();
    click(root, '[data-send="submit"]');
    const popover = root.querySelector(".canvas .payload-popover");
    expect(popover).not.toBeNull();
    expect(root.querySelector(".panel [data-payload-form]")).toBeNull();
    popover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector(".payload-popover")).toBeNull();
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
  const submit: VizStep = { kind: "event", event: "submit", payload: { amount: 5 } };
  const withRuns: VizMachine = {
    ...checkout,
    runs: [
      { name: "pays and times out", steps: [submit, { kind: "advance", ms: 800 }] },
      { name: "submits", steps: [submit] },
      { name: "empty", steps: [] },
      { name: "breaks", steps: [{ kind: "event", event: "nope", payload: null }, submit] },
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

  function mountFields(machine: VizMachine = fieldsMachine) {
    const root = document.createElement("div");
    const live = driver();
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver: live });
    return { root, live };
  }
  const field = (root: HTMLElement, name: string) =>
    root.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-field="${name}"]`);

  test("the note is present when live and absent without a driver", () => {
    expect(mountFields().root.querySelector("[data-live-note]")).not.toBeNull();
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [fieldsMachine] });
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
      { kind: "event", event: "submit", payload: { validFor: "10m", flags: { a: false } } },
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
