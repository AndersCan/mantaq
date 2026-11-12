import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";
import { isAnyState, scopeOf } from "../schema.ts";
import type { VizActorRef, VizLiveState, VizLiveStep, VizMachine } from "../schema.ts";
import { linksInside, systemOf } from "../system.ts";
import type { MachineSystem, SystemEntry, SystemLink, SystemPart } from "../system.ts";
import { localName } from "./compartments.ts";
import { activatable, html, svg } from "./dom.ts";
import { polyline } from "./layout.ts";

export type SystemSelection = { kind: "link"; id: string } | { kind: "part"; id: string };

export interface SystemCallbacks {
  select(selection: SystemSelection): void;
  /** Sends a root event as a pulsing arrow's click does. Unset without a driver: the entry lines are not clickable. */
  send?(entry: SystemEntry): void;
}

/** Where the viewer goes from the system view: a state or an edge of the diagram, or nowhere in particular. */
export type OpenTarget = { kind: "edge" | "state"; id: string } | null;

const CHAR_WIDTH = 7;
const NODE_HEIGHT = 48;
const END_HEIGHT = 28;
const LABEL_HEIGHT = 16;
const ENTRY_NODE = "entry";
const ENTRY_TEXT = "from outside";

/** The system of a machine when it has arrows between parts, else null: the viewer then draws the diagram alone. */
export function systemFor(machine: VizMachine): MachineSystem | null {
  const system = systemOf(machine);
  return linksInside(system) ? system : null;
}

function linkKey(link: SystemLink): string {
  return `${link.from}|${link.to ?? ""}|${link.event}`;
}

function partOf(system: MachineSystem, id: string): SystemPart | undefined {
  return system.parts.find((part) => part.id === id);
}

function labelOf(system: MachineSystem, id: string | null): string {
  return (id === null ? undefined : partOf(system, id)?.label) ?? "";
}

/** Non-`*` states of a part, in the document's order. */
function statesOf(machine: VizMachine, part: string): VizMachine["states"] {
  return machine.states.filter((state) => (state.region ?? "") === part);
}

const MAX_DOTS = 6;
const DOT_GAP = 16;

/** The two states a map's child dots tell apart, in document order; null when the child machine has any other number of non-final states. */
function dotStatesOf(machine: VizMachine, part: SystemPart): [string, string] | null {
  if (part.kind !== "map") return null;
  const open = statesOf(machine, part.id).filter((state) => !state.final);
  const [first, second, ...rest] = open;
  if (first === undefined || second === undefined || rest.length > 0) return null;
  return [first.id, second.id];
}

/** The dots a map draws: its two states and its children sorted by key; null when it draws the count text instead (other shape, no children, over the limit, or a child outside the two states). */
function dotsOf(
  machine: VizMachine,
  context: { part: SystemPart; live: VizLiveState | null },
): { states: [string, string]; children: VizLiveState["children"] } | null {
  const { part, live } = context;
  const states = dotStatesOf(machine, part);
  if (states === null || live === null) return null;
  const children = live.children
    .filter((child) => child.map === part.id)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (children.length === 0 || children.length > MAX_DOTS) return null;
  if (children.some((child) => !states.includes(child.state))) return null;
  return { states, children };
}

/** The key item for child dots, `○ free  ● working`, or null when no map draws dots right now. */
export function dotKey(
  machine: VizMachine,
  context: { system: MachineSystem; live: VizLiveState | null },
): string | null {
  for (const part of context.system.parts) {
    const drawn = dotsOf(machine, { part, live: context.live });
    if (drawn === null) continue;
    return `○ ${localName(drawn.states[0])}  ● ${localName(drawn.states[1])}`;
  }
  return null;
}

/** Widest the chip can read: a map lists every state with a two-digit count. */
function chipWidth(machine: VizMachine, part: SystemPart): number {
  const states = statesOf(machine, part.id).map((state) => state.label);
  if (part.kind === "map") {
    return Math.min(40, states.map((label) => `${label} 99`).join(" · ").length);
  }
  return Math.max(0, ...states.map((label) => label.length));
}

/** `p.` when 2 or more events share the text `p` before the first `.` and stay non-empty stripped; else "". */
export function sharedPrefix(events: ReadonlyArray<string>): string {
  const unique = [...new Set(events)];
  const [first] = unique;
  if (first === undefined || unique.length < 2) return "";
  const dot = first.indexOf(".");
  if (dot <= 0) return "";
  const prefix = first.slice(0, dot + 1);
  const shared = unique.every((event) => event.startsWith(prefix) && event.length > prefix.length);
  return shared ? prefix : "";
}

/** The prefix every event name drawn in the system view shares, else "". */
export function systemPrefix(system: MachineSystem): string {
  return sharedPrefix([
    ...system.links.map((link) => link.event),
    ...system.entries.map((entry) => entry.event),
  ]);
}

interface Pair {
  key: string;
  from: string;
  /** null = leaves the machine. */
  to: string | null;
  links: SystemLink[];
}

/** One pair per `from>to`: its events are lines on one arrow. */
function pairsOf(system: MachineSystem): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const link of system.links) {
    const key = `${link.from}>${link.to ?? "out"}`;
    const pair = pairs.get(key) ?? { key, from: link.from, to: link.to, links: [] };
    pair.links.push(link);
    pairs.set(key, pair);
  }
  return [...pairs.values()];
}

/** The parts that take events from outside, each with its sorted events. */
function entryGroups(system: MachineSystem): Array<{ to: string; events: string[] }> {
  return system.parts.flatMap((part) => {
    const events = system.entries
      .filter((entry) => entry.to === part.id)
      .map((entry) => entry.event);
    return events.length === 0 ? [] : [{ to: part.id, events }];
  });
}

function labelFor(lines: ReadonlyArray<string>): EdgeLabel {
  return {
    width: Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH + 8,
    height: LABEL_HEIGHT * lines.length,
    labelpos: "c",
  };
}

function placeLinks(
  machine: VizMachine,
  system: MachineSystem,
  prefix: string,
): { graph: Graph<GraphLabel, NodeLabel, EdgeLabel> } {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 36,
    ranksep: 96,
    edgesep: 14,
    marginx: 32,
    marginy: 32,
  });
  for (const part of system.parts) {
    const chars = Math.max(part.label.length + 3, chipWidth(machine, part));
    graph.setNode(`part:${part.id}`, {
      width: Math.max(96, chars * CHAR_WIDTH + 24),
      height: NODE_HEIGHT,
    });
  }
  for (const pair of pairsOf(system)) {
    const lines = pair.links.map((link) => link.event.slice(prefix.length));
    if (pair.to === null) {
      graph.setNode(`end:${pair.from}`, {
        width: endText(machine).length * CHAR_WIDTH + 16,
        height: END_HEIGHT,
      });
    }
    graph.setEdge(
      `part:${pair.from}`,
      pair.to === null ? `end:${pair.from}` : `part:${pair.to}`,
      labelFor(lines),
      pair.key,
    );
  }
  const groups = entryGroups(system);
  if (groups.length > 0) {
    graph.setNode(ENTRY_NODE, {
      width: ENTRY_TEXT.length * CHAR_WIDTH + 24,
      height: END_HEIGHT,
    });
  }
  for (const group of groups) {
    graph.setEdge(
      ENTRY_NODE,
      `part:${group.to}`,
      labelFor(group.events.map((event) => event.slice(prefix.length))),
      `in>${group.to}`,
    );
  }
  layout(graph);
  return { graph };
}

function endText(machine: VizMachine): string {
  return `out of ${machine.id}`;
}

function partGroup(
  doc: Document,
  part: SystemPart,
  context: { at: NodeLabel; dots: boolean; callbacks: SystemCallbacks },
) {
  const { at, dots, callbacks } = context;
  const x = at.x ?? 0;
  const y = at.y ?? 0;
  const group = svg(doc, "g", { class: "state part", "data-part": part.id }, [
    svg(doc, "rect", {
      class: "frame",
      x: x - at.width / 2,
      y: y - at.height / 2,
      width: at.width,
      height: at.height,
      rx: 8,
    }),
    svg(doc, "text", { class: "part-label", x, y: y - 4, "text-anchor": "middle" }, [part.label]),
    svg(doc, "text", { class: "part-chip", x, y: y + 14, "text-anchor": "middle" }),
    dots ? svg(doc, "g", { class: "part-dots", transform: `translate(${x} ${y + 11})` }) : null,
  ]);
  activatable(group, () => callbacks.select({ kind: "part", id: part.id }));
  return group;
}

function endMark(doc: Document, at: NodeLabel, text: string, className: string): SVGGElement {
  const x = at.x ?? 0;
  const y = at.y ?? 0;
  return svg(doc, "g", { class: className }, [
    svg(doc, "rect", {
      x: x - at.width / 2,
      y: y - at.height / 2,
      width: at.width,
      height: at.height,
      rx: at.height / 2,
    }),
    svg(doc, "text", { x, y: y + 4, "text-anchor": "middle" }, [text]),
  ]);
}

/** The "from outside" pill. With a driver and a single entry event it sends that event, as its label does. */
function entryPill(
  doc: Document,
  at: NodeLabel,
  groups: Array<{ to: string; events: string[] }>,
  context: { callbacks: SystemCallbacks; system: MachineSystem },
): SVGGElement {
  const pill = endMark(doc, at, ENTRY_TEXT, "link-start");
  const { send } = context.callbacks;
  const only = groups.length === 1 && groups[0]?.events.length === 1 ? groups[0] : undefined;
  const event = only?.events[0];
  if (send === undefined || only === undefined || event === undefined) return pill;
  pill.setAttribute("aria-label", `${event}: ${ENTRY_TEXT} to ${labelOf(context.system, only.to)}`);
  activatable(pill, () => send({ event, to: only.to }));
  return pill;
}

/** Baseline of line `index` of `count` stacked lines centred on `y`. */
function lineY(y: number, index: number, count: number): number {
  return y - (LABEL_HEIGHT * count) / 2 + LABEL_HEIGHT * index + LABEL_HEIGHT - 4;
}

function lineText(doc: Document, text: string, at: { x: number; y: number }) {
  return svg(doc, "text", { x: at.x, y: at.y, "text-anchor": "middle" }, [text]);
}

function pairGroup(
  doc: Document,
  pair: Pair,
  context: {
    graph: Graph<GraphLabel, NodeLabel, EdgeLabel>;
    machine: VizMachine;
    callbacks: SystemCallbacks;
    system: MachineSystem;
    prefix: string;
  },
) {
  const { graph, machine, callbacks, system, prefix } = context;
  const end = pair.to === null ? `end:${pair.from}` : `part:${pair.to}`;
  const placed = graph.edge(`part:${pair.from}`, end, pair.key);
  const endNode = pair.to === null ? graph.node(end) : null;
  const lines = pair.links.map((link, index) => {
    const group = svg(
      doc,
      "g",
      {
        class: "edge link",
        "data-link": linkKey(link),
        "data-from": link.from,
        "data-to": link.to ?? "",
        "data-event": link.event,
        ...(link.to === null ? { "data-link-out": "" } : {}),
        "aria-label": `${link.event}: ${labelOf(system, link.from)} to ${link.to === null ? endText(machine) : labelOf(system, link.to)}`,
      },
      [
        lineText(doc, link.event.slice(prefix.length), {
          x: placed.x ?? 0,
          y: lineY(placed.y ?? 0, index, pair.links.length),
        }),
      ],
    );
    activatable(group, () => callbacks.select({ kind: "link", id: linkKey(link) }));
    return group;
  });
  return svg(
    doc,
    "g",
    {
      class: "edge link-pair",
      "data-from": pair.from,
      "data-to": pair.to ?? "",
      ...(pair.to === null ? { "data-link-out": "" } : {}),
    },
    [
      svg(doc, "path", { d: polyline(placed.points ?? []), "marker-end": "url(#viz-arrow)" }),
      ...lines,
      endNode === null ? null : endMark(doc, endNode, endText(machine), "link-end"),
    ],
  );
}

function entryGroup(
  doc: Document,
  group: { to: string; events: string[] },
  context: {
    graph: Graph<GraphLabel, NodeLabel, EdgeLabel>;
    callbacks: SystemCallbacks;
    system: MachineSystem;
    prefix: string;
  },
) {
  const { graph, callbacks, system, prefix } = context;
  const placed = graph.edge(ENTRY_NODE, `part:${group.to}`, `in>${group.to}`);
  const { send } = callbacks;
  const lines = group.events.map((event, index) => {
    const line = svg(
      doc,
      "g",
      {
        class: "edge entry",
        "data-entry-event": event,
        "aria-label": `${event}: ${ENTRY_TEXT} to ${labelOf(system, group.to)}`,
      },
      [
        lineText(doc, event.slice(prefix.length), {
          x: placed.x ?? 0,
          y: lineY(placed.y ?? 0, index, group.events.length),
        }),
      ],
    );
    if (send !== undefined) activatable(line, () => send({ event, to: group.to }));
    return line;
  });
  return svg(doc, "g", { class: "edge link-in", "data-to": group.to }, [
    svg(doc, "path", { d: polyline(placed.points ?? []), "marker-end": "url(#viz-arrow)" }),
    ...lines,
  ]);
}

/** The system SVG: one box per part, one arrow per direction between parts, a pill where work enters. Counts and colours come from `markSystem`. */
export function renderSystem(
  doc: Document,
  machine: VizMachine,
  system: MachineSystem,
  callbacks: SystemCallbacks,
): SVGSVGElement {
  const prefix = systemPrefix(system);
  const { graph } = placeLinks(machine, system, prefix);
  const size = graph.graph();
  const width = Math.ceil(size.width ?? 0);
  const height = Math.ceil(size.height ?? 0);
  const groups = entryGroups(system);
  return svg(
    doc,
    "svg",
    {
      class: "graph system-graph",
      "data-system": "",
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      style: `width: min(100%, ${((width * 1.4) / 12).toFixed(2)}em)`,
      role: "group",
      "aria-label": `parts of ${machine.id}`,
    },
    [
      svg(doc, "defs", {}, [
        svg(
          doc,
          "marker",
          {
            id: "viz-arrow",
            viewBox: "0 0 10 10",
            refX: 9,
            refY: 5,
            markerWidth: 7,
            markerHeight: 7,
            orient: "auto-start-reverse",
          },
          [svg(doc, "path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head" })],
        ),
      ]),
      groups.length === 0
        ? null
        : entryPill(doc, graph.node(ENTRY_NODE), groups, { callbacks, system }),
      ...groups.map((group) => entryGroup(doc, group, { graph, callbacks, system, prefix })),
      ...pairsOf(system).map((pair) =>
        pairGroup(doc, pair, { graph, machine, callbacks, system, prefix }),
      ),
      ...system.parts.map((part) =>
        partGroup(doc, part, {
          at: graph.node(`part:${part.id}`),
          dots: dotStatesOf(machine, part) !== null,
          callbacks,
        }),
      ),
    ],
  );
}

function actorPart(actor: VizActorRef | undefined): string {
  if (actor === undefined) return "";
  return "region" in actor ? actor.region : actor.map;
}

/** The chip under a part's name: its state, or a map's children counted by state. null = no driver. */
function chipOf(
  machine: VizMachine,
  part: SystemPart,
  live: VizLiveState | null,
): { text: string; label: string; name: string } {
  if (live === null) {
    return {
      text: "",
      label: part.kind === "map" ? `${part.label} ×n` : part.label,
      name: part.label,
    };
  }
  if (part.kind !== "map") {
    const id = part.id === "" ? live.state : live.regions[part.id];
    const text = id === undefined ? "" : localName(id);
    return { text, label: part.label, name: text === "" ? part.label : `${part.label}: ${text}` };
  }
  const children = live.children.filter((child) => child.map === part.id);
  const counts = statesOf(machine, part.id)
    .map((state) => ({
      name: state.label,
      n: children.filter((child) => child.state === state.id).length,
    }))
    .filter((count) => count.n > 0)
    .map((count) => `${count.name} ${count.n}`);
  const label = `${part.label} ×${children.length}`;
  if (children.length === 0)
    return { text: "none running", label, name: `${part.label}, none running` };
  return {
    text: counts.join(" · "),
    label,
    name: `${part.label}, ${children.length} running: ${counts.join(", ")}`,
  };
}

/** Replaces the dots in `group` with one per child, sorted by key; false (and no dots) when the part does not draw them. */
function markDots(
  group: Element,
  context: { machine: VizMachine; part: SystemPart; live: VizLiveState | null },
): boolean {
  const { machine, part, live } = context;
  const holder = group.querySelector("g.part-dots");
  if (holder === null) return false;
  const drawn = dotsOf(machine, { part, live });
  if (drawn === null) {
    holder.replaceChildren();
    return false;
  }
  const { states, children } = drawn;
  const doc = holder.ownerDocument;
  holder.replaceChildren(
    ...children.map((child, index) => {
      const state = localName(child.state);
      const cx = (index - (children.length - 1) / 2) * DOT_GAP;
      return svg(
        doc,
        "g",
        {
          class: "child-dot",
          "data-child": child.key,
          "data-state": state,
          "data-mark": child.state === states[0] ? "first" : "second",
        },
        [
          svg(doc, "circle", { cx, cy: 0, r: 5 }),
          svg(doc, "title", {}, [`${child.key}, ${state}`]),
        ],
      );
    }),
  );
  return true;
}

/** Arrows whose receiver took their event in the last step or in what followed it. */
function tookKeys(system: MachineSystem, live: VizLiveState | null): Set<string> {
  if (live === null) return new Set();
  const entries: VizLiveStep[] = [...(live.last === null ? [] : [live.last]), ...live.after];
  const took = entries.filter((entry) => entry.outcome !== "missing");
  return new Set(
    system.links
      .filter((link) =>
        took.some((entry) => entry.event === link.event && actorPart(entry.actor) === link.to),
      )
      .map(linkKey),
  );
}

/** Fills one part's chip, dots, name and selection mark. */
function markPart(
  groups: ReadonlyArray<Element>,
  part: SystemPart,
  context: { machine: VizMachine; live: VizLiveState | null; selection: SystemSelection | null },
): void {
  const { machine, live, selection } = context;
  const group = groups.find(
    (each) => each.classList.contains("part") && each.getAttribute("data-part") === part.id,
  );
  if (group === undefined) return;
  const chip = chipOf(machine, part, live);
  const label = group.querySelector(".part-label");
  const line = group.querySelector(".part-chip");
  if (label !== null) label.textContent = chip.label;
  const dotted = markDots(group, { machine, part, live });
  if (line !== null) line.textContent = dotted ? "" : chip.text;
  group.setAttribute("aria-label", chip.name);
  group.classList.toggle("selected", selection?.kind === "part" && selection.id === part.id);
}

/** Every state of `part` the actor is in now: the root's, a region's, or each child's of a map. */
function currentsOf(part: string, live: VizLiveState): string[] {
  const child = live.children.filter((each) => each.map === part).map((each) => each.state);
  if (child.length > 0) return child;
  const id = part === "" ? live.state : live.regions[part];
  return id === undefined ? [] : [id];
}

/** Whether `part` handles `event` in a state it is in now. A final state handles nothing. */
function canTake(machine: VizMachine, part: string, event: string, live: VizLiveState): boolean {
  return currentsOf(part, live).some(
    (current) =>
      machine.states.find((state) => state.id === current)?.final !== true &&
      machine.edges.some(
        (each) =>
          each.event === event &&
          (each.from === current || (isAnyState(each.from) && scopeOf(each.from) === part)),
      ),
  );
}

/** Fills chips and names from the driver, and sets the pink and teal marks. Runs after every step and selection. */
export function markSystem(
  root: ParentNode,
  context: {
    machine: VizMachine;
    system: MachineSystem;
    live: VizLiveState | null;
    selection: SystemSelection | null;
  },
): void {
  const { machine, system, live, selection } = context;
  const took = tookKeys(system, live);
  const groups = [...root.querySelectorAll("g.part, g.link")];
  const pairs = [...root.querySelectorAll("g.link-pair")];
  for (const part of system.parts) markPart(groups, part, { machine, live, selection });
  for (const group of groups) {
    const key = group.getAttribute("data-link");
    if (key === null) continue;
    group.classList.toggle("took", took.has(key));
    group.classList.toggle("selected", selection?.kind === "link" && selection.id === key);
  }
  for (const entry of root.querySelectorAll("g.link-in")) {
    const part = entry.getAttribute("data-to") ?? "";
    const events = [...entry.querySelectorAll("g.entry")].map(
      (line) => line.getAttribute("data-entry-event") ?? "",
    );
    entry.classList.toggle(
      "next",
      live !== null && events.some((event) => canTake(machine, part, event, live)),
    );
  }
  for (const pair of pairs) {
    const lines = [...pair.querySelectorAll("g.link")];
    pair.classList.toggle(
      "took",
      lines.some((line) => line.classList.contains("took")),
    );
    pair.classList.toggle(
      "selected",
      lines.some((line) => line.classList.contains("selected")),
    );
  }
}

/** The edge in `part` that takes `event` in `state`, else that state: where "Open <part> at <state>" lands. */
function handlerIn(machine: VizMachine, part: string, event: string, state: string): OpenTarget {
  const edge =
    machine.edges.find((each) => each.event === event && each.from === state) ??
    machine.edges.find(
      (each) => each.event === event && isAnyState(each.from) && scopeOf(each.from) === part,
    );
  return edge === undefined ? { kind: "state", id: state } : { kind: "edge", id: edge.id };
}

function senderIn(machine: VizMachine, link: SystemLink): OpenTarget {
  const [first] = link.senders;
  if (first !== undefined) return { kind: "edge", id: first };
  const start =
    statesOf(machine, link.from).find((state) => state.initial) ?? statesOf(machine, link.from)[0];
  return start === undefined ? null : { kind: "state", id: start.id };
}

function openButton(
  doc: Document,
  text: string,
  context: { target: OpenTarget; open: (target: OpenTarget) => void },
) {
  const button = html(doc, "button", { type: "button", "data-open-part": "" }, [text]);
  button.addEventListener("click", () => context.open(context.target));
  return button;
}

function receiverLine(machine: VizMachine, system: MachineSystem, link: SystemLink): string {
  const part = partOf(system, link.to ?? "");
  if (part === undefined) return "";
  const anyState = machine.edges.some(
    (each) => each.event === link.event && isAnyState(each.from) && scopeOf(each.from) === part.id,
  );
  const where = anyState ? "in every state" : `in: ${link.handledIn.map(localName).join(", ")}`;
  return `${part.label} ${part.kind === "map" ? "take" : "takes"} it ${where}.`;
}

function senderLine(machine: VizMachine, system: MachineSystem, link: SystemLink): string {
  const on = [
    ...new Set(link.senders.map((id) => machine.edges.find((edge) => edge.id === id)?.event)),
  ]
    .filter((event): event is string => event !== undefined)
    .join(", ");
  return `${labelOf(system, link.from)} sends ${link.event}.${on === "" ? "" : ` On: ${on}.`}`;
}

/** Details tab of the system view: who sends the arrow, who takes it where, and ways into the diagram. */
export function systemDetails(
  doc: Document,
  context: {
    machine: VizMachine;
    system: MachineSystem;
    selection: SystemSelection;
    live: VizLiveState | null;
    open: (target: OpenTarget) => void;
  },
): HTMLElement | null {
  const { machine, system, selection, open } = context;
  if (selection.kind === "part") {
    const part = partOf(system, selection.id);
    if (part === undefined) return null;
    const chip = chipOf(machine, part, context.live);
    const start = statesOf(machine, part.id).find((state) => state.initial);
    return html(doc, "section", { class: "details", "data-selected-part": part.id }, [
      html(doc, "h2", {}, [part.label]),
      chip.text === "" ? null : html(doc, "p", { "data-part-state": "" }, [chip.text]),
      openButton(doc, `Open ${part.label}`, {
        target: start === undefined ? null : { kind: "state", id: start.id },
        open,
      }),
    ]);
  }
  const link = system.links.find((each) => linkKey(each) === selection.id);
  if (link === undefined) return null;
  const first = link.handledIn[0];
  return html(doc, "section", { class: "details", "data-selected-link": selection.id }, [
    html(doc, "h2", {}, [link.event]),
    html(doc, "p", { "data-link-sender": "" }, [senderLine(machine, system, link)]),
    link.to === null
      ? html(doc, "p", { "data-link-receiver": "" }, [
          `Nothing in ${machine.id} takes it; it leaves the machine.`,
        ])
      : html(doc, "p", { "data-link-receiver": "" }, [receiverLine(machine, system, link)]),
    openButton(doc, `Open ${labelOf(system, link.from)}`, {
      target: senderIn(machine, link),
      open,
    }),
    link.to === null || first === undefined
      ? null
      : openButton(doc, `Open ${labelOf(system, link.to)} at ${localName(first)}`, {
          target: handlerIn(machine, link.to, link.event, first),
          open,
        }),
  ]);
}

/** On a diagram edge: the line and button for each linked event it sends to another part. */
export function sendsLines(
  doc: Document,
  context: {
    machine: VizMachine;
    system: MachineSystem;
    edge: VizMachine["edges"][number];
    open: (target: OpenTarget) => void;
  },
): HTMLElement[] {
  const { machine, system, edge, open } = context;
  return system.links
    .filter(
      (link) =>
        link.to !== null && link.from === scopeOf(edge.from) && edge.emits.includes(link.event),
    )
    .flatMap((link) => {
      const first = link.handledIn[0];
      if (link.to === null || first === undefined) return [];
      const to = labelOf(system, link.to);
      return [
        html(doc, "p", { "data-sends": link.event }, [`Sends ${link.event} to ${to}`]),
        openButton(doc, `Open ${to} at ${localName(first)}`, {
          target: handlerIn(machine, link.to, link.event, first),
          open,
        }),
      ];
    });
}
