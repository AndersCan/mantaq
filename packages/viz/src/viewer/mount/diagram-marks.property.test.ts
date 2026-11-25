// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type {
  VizDocument,
  VizDriver,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizStep,
} from "../../schema.ts";
import { arrowSend } from "./arrow-send.ts";
import fc from "fast-check";
import { initialView } from "./view-state.ts";
import { machineArbitrary } from "../layout.arbitrary.ts";
import { memberSelection } from "./arrow-click.ts";
import { mountViewer } from "../embed.ts";
import { renderGraph } from "../graph.ts";
import { VIZ_SCHEMA_VERSION } from "../../schema.ts";

/** Where a generated walk is: one state per scope, and the children of each map. */
interface Place {
  state: string;
  regions: Record<string, string>;
  children: VizLiveState["children"];
}

function liveAt(place: Place): VizLiveState {
  return {
    ...place,
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: {},
    payload: null,
    effectMode: "held",
    waiting: [],
  };
}

interface ScopeOptions {
  /** A region path; "" is the machine's own states. */
  scope: string;
}

/** The ids of the states of one scope; [""] when it has none, so a pick never fails. */
function inScope(machine: VizMachine, options: ScopeOptions): string[] {
  const ids: string[] = [];
  for (const state of machine.states) {
    if ((state.region ?? "") === options.scope) ids.push(state.id);
  }
  return ids.length === 0 ? [""] : ids;
}

function regionsArbitrary(machine: VizMachine): fc.Arbitrary<Record<string, string>> {
  const regions = machine.regions.filter((region) => !machine.maps.includes(region));
  const picks = regions.map((region) => fc.constantFrom(...inScope(machine, { scope: region })));
  return fc.tuple(...picks).map((ids) => {
    const placed: Record<string, string> = {};
    for (const [index, region] of regions.entries()) {
      const id = ids[index] ?? "";
      if (id !== "") placed[region] = id;
    }
    return placed;
  });
}

function childrenArbitrary(machine: VizMachine): fc.Arbitrary<Place["children"]> {
  const perMap = machine.maps.map((map) =>
    fc
      .array(fc.constantFrom(...inScope(machine, { scope: map })), { maxLength: 2 })
      .map((states) => {
        const children: Place["children"] = [];
        for (const [index, state] of states.entries()) {
          if (state !== "") children.push({ map, key: `k${index}`, state, since: 0 });
        }
        return children;
      }),
  );
  return fc.tuple(...perMap).map((lists) => lists.flat());
}

function placeArbitrary(machine: VizMachine): fc.Arbitrary<Place> {
  return fc.record({
    state: fc.constantFrom(...inScope(machine, { scope: "" })),
    regions: regionsArbitrary(machine),
    children: childrenArbitrary(machine),
  });
}

interface DriverOptions {
  /** Events whose dry run stays, so their transition arrows are locked. */
  blocking: ReadonlySet<string>;
}

/** A driver that stays where it is put: a step is only logged, and `move` puts it elsewhere as an async result would. */
function driverAt(first: Place, options: DriverOptions) {
  let place = first;
  let steps: VizStep[] = [];
  let changed: ((state: VizLiveState) => void) | undefined;
  function now(): VizLiveState {
    return { ...liveAt(place), steps: [...steps] };
  }
  function tried(step: VizStep): VizLiveStep | null {
    if (step.kind !== "event" || !options.blocking.has(step.event)) return null;
    const stay = {
      from: place.state,
      event: step.event,
      to: place.state,
      outcome: "stay",
    } as const;
    return { ...stay, effects: [], sent: [], context: {}, error: null };
  }
  const driver: VizDriver = {
    reset: () => {
      steps = [];
      return now();
    },
    step: (step) => {
      steps = [...steps, step];
      return now();
    },
    listen: (onChange) => {
      changed = onChange;
    },
    dryRun: (candidates) => candidates.map(tried),
  };
  function move(next: Place): void {
    place = next;
    changed?.(now());
  }
  return { driver, sent: () => steps.length, move };
}

interface SendsOptions {
  /** The `data-edge-id` of the drawn arrow. */
  id: string;
  live: VizLiveState | null;
  driver: VizDriver | undefined;
}

/** Whether a click on the drawn arrow sends, from `arrowSend` alone: a shared arrow is its member at the current state, and a send no guard blocks. */
function sends(machine: VizMachine, options: SendsOptions): boolean {
  const view = initialView({}, { events: [] });
  view.live = options.live;
  const selection = memberSelection({ kind: "edge", id: options.id }, { machine, view });
  const edge = machine.edges.find((candidate) => candidate.id === selection.id);
  if (edge === undefined) return false;
  const decision = arrowSend({ machine, view, driver: options.driver }, edge);
  return decision.kind === "send" && decision.blocked === undefined;
}

/** How an element looks to a reader: its role and its place in the tab order, each undefined when unset. */
interface Look {
  role: string | undefined;
  tabindex: string | undefined;
}

function lookOf(element: Element): Look {
  return {
    role: element.getAttribute("role") ?? undefined,
    tabindex: element.getAttribute("tabindex") ?? undefined,
  };
}

const BUTTON: Look = { role: "button", tabindex: "0" };
const PLAIN: Look = { role: undefined, tabindex: undefined };
/** The current choice: Details show it already, so it keeps its tab stop and is no button. */
const CURRENT: Look = { role: undefined, tabindex: "0" };

function press(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const caseArbitrary = machineArbitrary.chain((machine) =>
  fc.record({
    machine: fc.constant(machine),
    first: placeArbitrary(machine),
    later: placeArbitrary(machine),
    driven: fc.boolean(),
    diagramOnly: fc.boolean(),
    blocking: fc.subarray([...new Set(machine.edges.map((edge) => edge.event))]),
  }),
);

interface ObserveOptions {
  root: HTMLElement;
  sent: () => number;
}

/** What a reader meets on one element: whether it looks like a button, and whether a click on it acted. */
interface Met {
  id: string;
  looked: Look;
  acted: boolean;
  /** Set on the state whose Details show before the click. */
  current?: true;
}

/** Each drawn arrow: does it look like a button, and does a click send. */
function arrowsMet(options: ObserveOptions): Met[] {
  const met: Met[] = [];
  for (const arrow of options.root.querySelectorAll(".graph g.edge[data-edge-id]")) {
    const before = options.sent();
    const looked = lookOf(arrow);
    press(arrow);
    met.push({
      id: arrow.getAttribute("data-edge-id") ?? "",
      looked,
      acted: options.sent() > before,
    });
  }
  return met;
}

function selectedState(root: HTMLElement): string | undefined {
  return (
    root.querySelector(".details[data-selected-state]")?.getAttribute("data-selected-state") ??
    undefined
  );
}

/** Each state: does it look like a button, and does a click open its Details. The state whose Details show already is the current choice. */
function statesMet(options: ObserveOptions): Met[] {
  const met: Met[] = [];
  for (const state of options.root.querySelectorAll(".graph g.state")) {
    const id = state.getAttribute("data-node-id") ?? "";
    const looked = lookOf(state);
    if (selectedState(options.root) === id) {
      met.push({ id, looked, acted: true, current: true });
      continue;
    }
    press(state);
    const selected = options.root.querySelector(".details[data-selected-state]");
    met.push({ id, looked, acted: selected?.getAttribute("data-selected-state") === id });
  }
  return met;
}

interface ExpectedOptions {
  /** Whether a click on the element with this id acts. */
  acts: (id: string) => boolean;
}

function expectedOf(met: ReadonlyArray<Met>, options: ExpectedOptions): Met[] {
  return met.map(({ id, current }) => {
    if (current === true) return { id, looked: CURRENT, acted: true, current };
    return { id, looked: options.acts(id) ? BUTTON : PLAIN, acted: options.acts(id) };
  });
}

describe("a state or an arrow is a button exactly when a click on it acts", () => {
  test("after each mark, with or without a driver and a panel", () => {
    fc.assert(
      fc.property(caseArbitrary, (generated) => {
        const { machine, diagramOnly } = generated;
        const walk = driverAt(generated.first, { blocking: new Set(generated.blocking) });
        const driver = generated.driven ? walk.driver : undefined;
        const root = document.createElement("div");
        const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] };
        mountViewer(root, viz, driver === undefined ? { diagramOnly } : { diagramOnly, driver });
        for (const place of [generated.first, generated.later]) {
          if (place !== generated.first) walk.move(place);
          const live = driver === undefined ? null : liveAt(place);
          const arrows = arrowsMet({ root, sent: walk.sent });
          const states = statesMet({ root, sent: walk.sent });
          expect({ arrows, states }).toEqual({
            arrows: expectedOf(arrows, { acts: (id) => sends(machine, { id, live, driver }) }),
            states: expectedOf(states, { acts: () => !diagramOnly }),
          });
        }
      }),
      { seed: 0xaff0, numRuns: 120, endOnFailure: true },
    );
  }, 60_000);

  test("before any mark, every state and arrow is drawn plain", () => {
    fc.assert(
      fc.property(machineArbitrary, (machine) => {
        const graph = renderGraph(document, machine, { select: () => undefined });
        const buttons = graph.querySelectorAll(
          "g.state[role], g.state[tabindex], g.edge[role], g.edge[tabindex]",
        );
        expect(buttons.length).toBe(0);
      }),
      { seed: 0xaff1, numRuns: 60, endOnFailure: true },
    );
  }, 60_000);
});
