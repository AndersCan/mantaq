import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";
import { isAnyState, scopeOf } from "../schema.ts";
import type { VizActorRef, VizLiveState, VizLiveStep, VizMachine } from "../schema.ts";
import { linksInside, systemOf } from "../system.ts";
import type { MachineSystem, SystemLink, SystemPart } from "../system.ts";
import { localName } from "./compartments.ts";
import { activatable, html, svg } from "./dom.ts";
import { polyline } from "./layout.ts";

export type SystemSelection = { kind: "link"; id: string } | { kind: "part"; id: string };

export interface SystemCallbacks {
  select(selection: SystemSelection): void;
}

/** Where the viewer goes from the system view: a state or an edge of the diagram, or nowhere in particular. */
export type OpenTarget = { kind: "edge" | "state"; id: string } | null;

const CHAR_WIDTH = 7;
const NODE_HEIGHT = 48;
const END_HEIGHT = 28;
const LABEL_HEIGHT = 16;

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

/** Widest the chip can read: a map lists every state with a two-digit count. */
function chipWidth(machine: VizMachine, part: SystemPart): number {
  const states = statesOf(machine, part.id).map((state) => state.label);
  if (part.kind === "map") {
    return Math.min(40, states.map((label) => `${label} 99`).join(" · ").length);
  }
  return Math.max(0, ...states.map((label) => label.length));
}

function placeLinks(
  machine: VizMachine,
  system: MachineSystem,
): { graph: Graph<GraphLabel, NodeLabel, EdgeLabel>; ends: Map<string, string> } {
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
  const ends = new Map<string, string>();
  for (const link of system.links) {
    const key = linkKey(link);
    const label: EdgeLabel = {
      width: link.event.length * CHAR_WIDTH + 8,
      height: LABEL_HEIGHT,
      labelpos: "c",
    };
    if (link.to === null) {
      ends.set(key, `end:${key}`);
      graph.setNode(`end:${key}`, {
        width: endText(machine).length * CHAR_WIDTH + 16,
        height: END_HEIGHT,
      });
    }
    graph.setEdge(
      `part:${link.from}`,
      link.to === null ? `end:${key}` : `part:${link.to}`,
      label,
      key,
    );
  }
  layout(graph);
  return { graph, ends };
}

function endText(machine: VizMachine): string {
  return `out of ${machine.id}`;
}

function partGroup(doc: Document, part: SystemPart, at: NodeLabel, callbacks: SystemCallbacks) {
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
  ]);
  activatable(group, () => callbacks.select({ kind: "part", id: part.id }));
  return group;
}

function endMark(doc: Document, at: NodeLabel, text: string): SVGGElement {
  const x = at.x ?? 0;
  const y = at.y ?? 0;
  return svg(doc, "g", { class: "link-end" }, [
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

function linkGroup(
  doc: Document,
  link: SystemLink,
  context: {
    graph: Graph<GraphLabel, NodeLabel, EdgeLabel>;
    machine: VizMachine;
    callbacks: SystemCallbacks;
    system: MachineSystem;
  },
) {
  const { graph, machine, callbacks, system } = context;
  const key = linkKey(link);
  const end = link.to === null ? `end:${key}` : `part:${link.to}`;
  const placed = graph.edge(`part:${link.from}`, end, key);
  const endNode = link.to === null ? graph.node(end) : null;
  const group = svg(
    doc,
    "g",
    {
      class: "edge link",
      "data-link": key,
      "data-from": link.from,
      "data-to": link.to ?? "",
      "data-event": link.event,
      ...(link.to === null ? { "data-link-out": "" } : {}),
      "aria-label": `${link.event}: ${labelOf(system, link.from)} to ${link.to === null ? endText(machine) : labelOf(system, link.to)}`,
    },
    [
      svg(doc, "path", { d: polyline(placed.points ?? []), "marker-end": "url(#viz-arrow)" }),
      svg(doc, "text", { x: placed.x ?? 0, y: (placed.y ?? 0) + 4, "text-anchor": "middle" }, [
        link.event,
      ]),
      endNode === null ? null : endMark(doc, endNode, endText(machine)),
    ],
  );
  activatable(group, () => callbacks.select({ kind: "link", id: key }));
  return group;
}

/** The system SVG: one box per part, one arrow per event between parts. Counts and colours come from `markSystem`. */
export function renderSystem(
  doc: Document,
  machine: VizMachine,
  system: MachineSystem,
  callbacks: SystemCallbacks,
): SVGSVGElement {
  const { graph } = placeLinks(machine, system);
  const size = graph.graph();
  const width = Math.ceil(size.width ?? 0);
  const height = Math.ceil(size.height ?? 0);
  return svg(
    doc,
    "svg",
    {
      class: "graph system-graph",
      "data-system": "",
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      style: `width: clamp(${((width * 0.6) / 12).toFixed(2)}rem, 100%, ${((width * 1.4) / 12).toFixed(2)}em)`,
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
      ...system.links.map((link) => linkGroup(doc, link, { graph, machine, callbacks, system })),
      ...system.parts.map((part) => partGroup(doc, part, graph.node(`part:${part.id}`), callbacks)),
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
  for (const part of system.parts) {
    const group = groups.find(
      (each) => each.classList.contains("part") && each.getAttribute("data-part") === part.id,
    );
    if (group === undefined) continue;
    const chip = chipOf(machine, part, live);
    const label = group.querySelector(".part-label");
    const line = group.querySelector(".part-chip");
    if (label !== null) label.textContent = chip.label;
    if (line !== null) line.textContent = chip.text;
    group.setAttribute("aria-label", chip.name);
    group.classList.toggle("selected", selection?.kind === "part" && selection.id === part.id);
  }
  for (const group of groups) {
    const key = group.getAttribute("data-link");
    if (key === null) continue;
    group.classList.toggle("took", took.has(key));
    group.classList.toggle("selected", selection?.kind === "link" && selection.id === key);
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
  const all = statesOf(machine, part.id);
  const where =
    all.length === link.handledIn.length
      ? "in every state"
      : `in: ${link.handledIn.map(localName).join(", ")}`;
  const taken = `${part.label} ${part.kind === "map" ? "take" : "takes"} it ${where}.`;
  const ignored = all
    .filter((state) => !state.final && !link.handledIn.includes(state.id))
    .map((state) => state.label);
  if (ignored.length === 0) return taken;
  return `${taken} ${part.kind === "map" ? "They ignore" : "It ignores"} it in: ${ignored.join(", ")}.`;
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
