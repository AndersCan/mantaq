import { activatable, html, onButtonPress, svg } from "./dom.ts";
import { ARROW_SIZE, FINAL_INSET } from "./geometry.ts";
import {
  canTurn,
  currentRowText,
  ENTER_TEXT,
  HELP_SLOT,
  layoutMachine,
  rowText,
  textWidth,
} from "./layout.ts";
import { edgeCondition, edgeLines } from "./labels.ts";
import { enteredGroupOf, isStub } from "./groups/group-machine.ts";
import type {
  Flow,
  LabelBox,
  PlacedAny,
  PlacedEdge,
  PlacedMachine,
  PlacedMessage,
  PlacedNode,
  PlacedRegion,
  PlacedState,
  PlacedUnknown,
  WalkInside,
} from "./layout.ts";
import type { VizEdge, VizMachine } from "../schema.ts";
import { drawnNodeName } from "./groups/fold-groups.ts";
import { Either } from "@mantaq/utils";
import { isNever } from "../is-never.ts";
import { placeBoard } from "./board.ts";
import type { Point } from "@dagrejs/dagre";

export type Selection = { kind: "edge"; id: string } | { kind: "state"; id: string };

/** A state or an arrow is drawn plain; the diagram marks make it a button where `select` does something, and only a button calls `select`. */
export interface GraphCallbacks {
  select(selection: Selection): void;
  /** Opens an arrow's Details without sending. Absent: no `?` is drawn (diagram-only). */
  details?: (edgeId: string) => void;
  /** Enters the group a group node folds. Absent: no enter control is drawn. */
  enter?: (entered: EnteredGroup) => void;
  /** Goes back from an entered group to the level around it, onto a stub's state. Absent: a stub is plain. */
  leave?: (state: string) => void;
}

/** A group entered from its node: the node's id (`@payment`) and the group's name. */
export interface EnteredGroup {
  node: string;
  name: string;
}

function classes(names: Record<string, boolean>): string {
  return Object.entries(names)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(" ");
}

function defs(doc: Document): SVGDefsElement {
  return svg(doc, "defs", {}, [
    svg(
      doc,
      "marker",
      {
        id: "viz-arrow",
        viewBox: "0 0 10 10",
        refX: 10,
        refY: 5,
        markerWidth: ARROW_SIZE,
        markerHeight: ARROW_SIZE,
        markerUnits: "userSpaceOnUse",
        orient: "auto-start-reverse",
      },
      [svg(doc, "path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head" })],
    ),
  ]);
}

function regionGroup(doc: Document, placed: PlacedRegion, isMap: boolean): SVGGElement {
  return svg(
    doc,
    "g",
    {
      class: "region",
      "data-region": placed.region,
      ...(isMap ? { "data-map": placed.region } : {}),
    },
    [
      svg(doc, "rect", {
        x: placed.x - placed.width / 2,
        y: placed.y - placed.height / 2,
        width: placed.width,
        height: placed.height,
        rx: 10,
      }),
      svg(doc, "text", { x: placed.title.x - placed.title.width / 2 + 4, y: placed.title.y + 4 }, [
        placed.region,
      ]),
    ],
  );
}

/** What drawing one node needs besides the node. */
interface NodeOptions {
  doc: Document;
  callbacks: GraphCallbacks;
  /** The drawn machine, so a node can name a group by its name. */
  drawn: VizMachine;
}

function chipGroups(placed: PlacedState | PlacedMachine, options: NodeOptions): SVGGElement[] {
  const { doc } = options;
  return placed.state.effects.map((effect, index) => {
    const box = placed.chips[index] ?? placed;
    const width = box.width;
    const y = box.y - box.height / 2;
    return svg(
      doc,
      "g",
      {
        class: "chip",
        "data-effect": effect.name,
        "data-state": placed.state.id,
        "aria-label": `effect ${effect.name}`,
      },
      [
        svg(doc, "rect", { x: box.x - width / 2, y, width, height: box.height, rx: 8 }),
        svg(doc, "text", { x: box.x, y: box.y + 4, "text-anchor": "middle" }, [effect.name]),
      ],
    );
  });
}

function stateGroup(placed: PlacedState | PlacedMachine, options: NodeOptions): SVGGElement {
  const { doc, callbacks } = options;
  const { state } = placed;
  const left = placed.x - placed.width / 2;
  const top = placed.y - placed.height / 2;
  const frame = { x: left, y: top, width: placed.width, height: placed.height, rx: 8 };
  const group = svg(
    doc,
    "g",
    {
      class: classes({
        state: true,
        initial: state.initial,
        final: state.final,
      }),
      "data-node-id": state.id,
      "aria-label": `state ${state.id}${state.final ? " (final)" : ""}`,
    },
    [
      ...stubTitle(state.id, options),
      svg(doc, "rect", { ...frame, class: "frame" }),
      state.final
        ? svg(doc, "rect", {
            x: left + FINAL_INSET,
            y: top + FINAL_INSET,
            width: placed.width - 2 * FINAL_INSET,
            height: placed.height - 2 * FINAL_INSET,
            rx: 5,
            class: "frame inner",
          })
        : null,
      svg(doc, "text", { x: placed.label.x, y: placed.label.y + 4, "text-anchor": "middle" }, [
        state.label,
      ]),
      ...chipGroups(placed, options),
      placed.workers === undefined
        ? null
        : svg(doc, "rect", {
            class: "worker-row",
            "aria-hidden": "true",
            x: placed.workers.x - placed.workers.width / 2,
            y: placed.workers.y - placed.workers.height / 2,
            width: placed.workers.width,
            height: placed.workers.height,
          }),
    ],
  );
  if (!isStub(options.drawn, { state: state.id })) {
    onButtonPress(group, { press: () => callbacks.select({ kind: "state", id: state.id }) });
    return group;
  }
  group.classList.add("stub");
  const label = group.getAttribute("aria-label");
  group.setAttribute(
    "aria-label",
    `${label}, outside group ${enteredGroupOf(options.drawn)?.name}`,
  );
  const { leave } = callbacks;
  if (leave !== undefined) activatable(group, () => leave(state.id));
  return group;
}

/** A stub's hover text: it stands for a state outside the group, and a click goes there. */
function stubTitle(state: string, options: NodeOptions): SVGTitleElement[] {
  const group = enteredGroupOf(options.drawn);
  if (group === undefined || group.states.includes(state)) return [];
  const name = drawnNodeName(options.drawn, { node: state });
  const outside = `${name} is outside group ${group.name}.`;
  const shown =
    options.callbacks.leave === undefined
      ? outside
      : `${outside} Click to go back and show it there.`;
  return [svg(options.doc, "title", {}, [shown])];
}

function unknownGroup(doc: Document, placed: PlacedUnknown): SVGGElement {
  return svg(
    doc,
    "g",
    { class: "unknown-node", "data-node-id": placed.id, "aria-label": "undetermined target" },
    [
      svg(doc, "circle", { cx: placed.x, cy: placed.y, r: placed.width / 2 }),
      svg(doc, "text", { x: placed.x, y: placed.y + 5, "text-anchor": "middle" }, ["?"]),
    ],
  );
}

function anyAria(placed: PlacedAny, options: NodeOptions): string {
  if (placed.states.length === 0) return "any non-final state (onAny handlers)";
  if (placed.label === "any state") return "any state";
  const names: string[] = [];
  for (const node of placed.states) names.push(drawnNodeName(options.drawn, { node }));
  const listed = names.join(", ");
  return `these ${placed.states.length} states: ${listed}`;
}

function anyGroup(placed: PlacedAny, options: NodeOptions): SVGGElement {
  const { doc } = options;
  const walked: Record<string, string> =
    placed.walked.length === 0 ? {} : { "data-states": JSON.stringify(placed.walked) };
  return svg(
    doc,
    "g",
    {
      class: "any-node",
      "data-node-id": placed.id,
      ...walked,
      "aria-label": anyAria(placed, options),
    },
    [
      svg(doc, "rect", {
        x: placed.x - placed.width / 2,
        y: placed.y - placed.height / 2,
        width: placed.width,
        height: placed.height,
        rx: placed.height / 2,
      }),
      svg(doc, "text", { x: placed.x, y: placed.y + 4, "text-anchor": "middle" }, [placed.label]),
    ],
  );
}

/** A box holding a smaller box: this state holds a machine. */
function machineGlyph(placed: PlacedMachine, options: NodeOptions): SVGGElement {
  const { doc } = options;
  const { glyph } = placed;
  const left = glyph.x - glyph.width / 2;
  const top = glyph.y - glyph.height / 2;
  return svg(doc, "g", { class: "machine-glyph", "aria-hidden": "true" }, [
    svg(doc, "rect", { x: left, y: top, width: glyph.width, height: glyph.height, rx: 2 }),
    svg(doc, "rect", {
      class: "core",
      x: glyph.x - glyph.width / 4,
      y: glyph.y - glyph.height / 4,
      width: glyph.width / 2,
      height: glyph.height / 2,
    }),
  ]);
}

interface EnterOptions {
  doc: Document;
  enter: (entered: EnteredGroup) => void;
  box: LabelBox;
}

/** The group node's enter control: it sits beside the node's own button so the two never nest. */
function enterGroup(placed: PlacedMachine, options: EnterOptions): SVGGElement {
  const { doc, enter, box } = options;
  const entered = { node: placed.state.id, name: placed.holds.group };
  const group = svg(
    doc,
    "g",
    {
      class: "machine-enter",
      "data-enter-group": entered.node,
      "aria-label": `enter group ${entered.name}`,
    },
    [
      svg(doc, "rect", {
        x: box.x - box.width / 2,
        y: box.y - box.height / 2,
        width: box.width,
        height: box.height,
        rx: box.height / 2,
      }),
      svg(doc, "text", { x: box.x, y: box.y + 4, "text-anchor": "middle" }, [ENTER_TEXT]),
    ],
  );
  activatable(group, () => enter(entered));
  return group;
}

/**
 * A group folded into one node, with the machine-node look: a glyph and a row
 * under its name, and an enter control. `data-states` lists its real states, so
 * the walk marks it current while it is in one; the row then names that state.
 */
function machineGroup(placed: PlacedMachine, options: NodeOptions): SVGGElement {
  const { doc } = options;
  const { holds } = placed;
  const state = stateGroup(placed, options);
  state.classList.add("machine");
  const count = rowText(holds);
  const name = svg(
    doc,
    "text",
    {
      class: "machine-name",
      "data-count": count,
      x: placed.name.x,
      y: placed.name.y + 4,
      "text-anchor": "middle",
    },
    [count],
  );
  state.append(machineGlyph(placed, options), name);
  const names: string[] = [];
  for (const node of holds.states) names.push(drawnNodeName(options.drawn, { node }));
  const listed = names.join(", ");
  state.setAttribute("aria-label", `group ${holds.group}, ${count}: ${listed}`);
  state.setAttribute("data-states", JSON.stringify(holds.states));
  const { enter } = options.callbacks;
  const controls =
    enter === undefined ? [] : [enterGroup(placed, { doc, enter, box: placed.enter })];
  return svg(doc, "g", { class: "machine-node", "data-group": holds.group }, [state, ...controls]);
}

export interface GroupStateOptions {
  /** The real state of the group the walk is in; undefined when it is in none. */
  state: string | undefined;
  walk: WalkInside;
}

/** Writes on a group node's row, and in its accessible description, which of its states the walk is in; its size when it is in none. */
export function markGroupState(node: Element, options: GroupStateOptions): void {
  const row = node.querySelector(":scope > .machine-name");
  if (row === null) return;
  const { state, walk } = options;
  if (state === undefined) {
    row.textContent = row.getAttribute("data-count");
    node.removeAttribute("aria-description");
    return;
  }
  const text = currentRowText(state, { walk });
  row.textContent = text;
  node.setAttribute("aria-description", text);
}

function nodeGroup(node: PlacedNode, options: NodeOptions): SVGGElement {
  switch (node.kind) {
    case "state":
      return stateGroup(node, options);
    case "machine":
      return machineGroup(node, options);
    case "any":
      return anyGroup(node, options);
    case "unknown":
      return unknownGroup(options.doc, node);
    default:
      return isNever(node);
  }
}

const LINE_HEIGHT = 16;

interface AriaOptions {
  machine: VizMachine;
  /** How many drawn states a shared arrow leaves; undefined for any other arrow. */
  sources: number | undefined;
}

function edgeAria(edge: VizEdge, options: AriaOptions): string {
  const text = edge.event;
  const { machine } = options;
  const target = edge.to === null ? "undetermined" : drawnNodeName(machine, { node: edge.to });
  const when = whenText(edge);
  if (options.sources !== undefined) {
    return `${options.sources} states on ${text} to ${target}${when}`;
  }
  const from = drawnNodeName(machine, { node: edge.from });
  if (edge.kind === "stay") return `${from} on ${text} stays`;
  return `${from} on ${text} to ${target}${when}`;
}

function whenText(edge: VizEdge): string {
  const condition = edgeCondition(edge);
  if (condition === null) return "";
  return condition === "else" || condition.startsWith("else if ")
    ? `, ${condition}`
    : ` when ${condition}`;
}

function edgeLabel(doc: Document, placed: PlacedEdge): SVGElement {
  const lines = edgeLines(placed.edge);
  const top = placed.text.y + 4 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  return svg(
    doc,
    "text",
    { x: placed.text.x, y: top, "text-anchor": "middle" },
    lines.map((line, index) =>
      svg(
        doc,
        "tspan",
        {
          x: placed.text.x,
          dy: index === 0 ? 0 : LINE_HEIGHT,
          class: index === 0 ? null : "edge-condition",
        },
        [line],
      ),
    ),
  );
}

function edgeGroup(
  doc: Document,
  placed: PlacedEdge,
  context: { machine: VizMachine; callbacks: GraphCallbacks },
): SVGGElement {
  const { edge } = placed;
  const internal = context.machine.events.find((event) => event.id === edge.event)?.internal;
  const group = svg(
    doc,
    "g",
    {
      class: classes({
        edge: true,
        stay: edge.kind === "stay",
        undetermined: edge.to === null,
        internal: internal === true,
      }),
      "data-edge-id": edge.id,
      "data-members": placed.members === undefined ? null : JSON.stringify(placed.members),
      "data-from": edge.from,
      "data-to": placed.target,
      "aria-label": edgeAria(edge, { machine: context.machine, sources: placed.sources }),
    },
    [
      svg(doc, "path", { class: "hit", d: placed.path, "aria-hidden": "true" }),
      svg(doc, "path", {
        d: placed.path,
        "marker-end": "url(#viz-arrow)",
        style:
          internal === true || edge.kind === "stay"
            ? `--viz-dot-gap: ${placed.dotGap.toFixed(1)}`
            : null,
      }),
      edgeLabel(doc, placed),
    ],
  );
  onButtonPress(group, { press: () => context.callbacks.select({ kind: "edge", id: edge.id }) });
  return group;
}

interface HelpOptions {
  placed: PlacedEdge;
  details: (id: string) => void;
  machine: VizMachine;
}

/** The `?` beside an arrow's label: opens its Details, never sends. */
function helpGroup(doc: Document, options: HelpOptions): SVGGElement {
  const { placed, details, machine } = options;
  const aria = edgeAria(placed.edge, { machine, sources: placed.sources });
  const lines = edgeLines(placed.edge);
  const cx = placed.text.x + textWidth(lines[0] ?? "", 12) / 2 + 2 + HELP_SLOT / 2;
  const cy = placed.text.y - ((lines.length - 1) * LINE_HEIGHT) / 2;
  const group = svg(
    doc,
    "g",
    {
      class: "edge-help",
      "data-details-edge": placed.edge.id,
      "data-members": placed.members === undefined ? null : JSON.stringify(placed.members),
      "aria-label": `Details of ${aria}`,
    },
    [
      svg(doc, "circle", { class: "hit", cx, cy, r: 10 }),
      svg(doc, "circle", { class: "ring", cx, cy, r: 5.5 }),
      svg(doc, "text", { x: cx, y: cy + 3, "text-anchor": "middle" }, ["?"]),
    ],
  );
  activatable(group, () => details(placed.edge.id));
  return group;
}

function entryArrow(doc: Document, entry: { from: Point; to: Point }): SVGGElement {
  return svg(doc, "g", { class: "entry", "aria-hidden": "true" }, [
    svg(doc, "circle", { cx: entry.from.x, cy: entry.from.y, r: 6 }),
    svg(doc, "path", {
      d: `M${entry.from.x},${entry.from.y} L${entry.to.x},${entry.to.y}`,
      "marker-end": "url(#viz-arrow)",
    }),
  ]);
}

/** Label size in viewBox units (`.graph text`). */
const LABEL_UNITS = 12;

/** Smallest label size (rem): follows the reader's font setting, not the host's text size. */
const LABEL_FLOOR_REM = 0.6;
/** Largest label size (em): tracks the host text. */
const LABEL_CAP_EM = 1.4;

/**
 * Sizes the drawing against its canvas: labels never drop under 0.6rem (about
 * 10px) nor grow past 1.4em; between those the drawing fills the canvas. A
 * machine too wide for the floor scrolls sideways by the reader's hand. A
 * drawing that runs down stays at the floor: growing it would grow its height.
 */
function graphWidth(units: number, options: FlowChoice): string {
  const size = (scale: number) => ((units * scale) / LABEL_UNITS).toFixed(2);
  const floor = `--graph-floor: ${size(LABEL_FLOOR_REM)}rem`;
  if (options.flow === "down") return `${floor}; width: var(--graph-floor)`;
  return `${floor}; width: clamp(var(--graph-floor), 100%, ${size(LABEL_CAP_EM)}em)`;
}

function messageGroup(doc: Document, message: PlacedMessage): SVGElement {
  return svg(
    doc,
    "g",
    {
      class: "message",
      "aria-hidden": "true",
      "data-message-from": message.from,
      "data-message-to": message.to,
    },
    [
      svg(doc, "path", {
        d: message.path,
        "marker-end": "url(#viz-arrow)",
        style: `--viz-dot-gap: ${message.dotGap}`,
      }),
    ],
  );
}

/** The overlap warning's text for a drawing with `count` overlaps (its `data-overlaps`), or undefined when nothing overlaps. */
export function overlapWarning(count: number): string | undefined {
  if (count === 0) return undefined;
  const noun = count === 1 ? "overlap" : "overlaps";
  return `${count} ${noun}: some labels or lines touch.`;
}

type Laid = ReturnType<typeof layoutMachine>;

/** Layouts by machine and flow, so moving back and forth between machines lays each one out once. */
const layouts = new WeakMap<VizMachine, Map<Flow, Laid>>();

interface FlowChoice {
  flow: Flow;
}

function layoutOnce(machine: VizMachine, options: FlowChoice): Laid {
  const { flow } = options;
  const known = layouts.get(machine) ?? new Map<Flow, Laid>();
  layouts.set(machine, known);
  const laid = known.get(flow) ?? layoutMachine(machine, { flow });
  known.set(flow, laid);
  return laid;
}

interface RoomOptions {
  /** Pixels to the rem on the page. */
  rem: number;
}

/** How many layout units a canvas `width` px wide shows with its labels at the smallest size. */
export function roomAtFloor(width: number, options: RoomOptions): number {
  return (width * LABEL_UNITS) / (LABEL_FLOOR_REM * options.rem);
}

export interface FlowOptions {
  /** Layout units the canvas shows at the smallest label size (`roomAtFloor`); unset when the canvas is not laid out. */
  room?: number;
}

/** Left to right when that fits the room or the room is unknown; else top to bottom when that is narrower and overlaps no more. */
export function flowFor(machine: VizMachine, options: FlowOptions): Flow {
  const { room } = options;
  const across = Either.getRight(layoutOnce(machine, { flow: "across" }));
  const fits = across === undefined || room === undefined || across.layout.width <= room;
  if (fits || !canTurn(machine)) return "across";
  const down = Either.getRight(layoutOnce(machine, { flow: "down" }));
  if (down === undefined) return "across";
  const narrower = down.layout.width < across.layout.width;
  return narrower && down.overlaps.length <= across.overlaps.length ? "down" : "across";
}

/** What a graph is drawn with: what its clicks do, and the room it has. */
export type GraphOptions = GraphCallbacks & FlowOptions;

/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. An overlapping layout is drawn too; `data-overlaps` counts what overlaps. `data-flow` says which way its ranks run. */
export function renderGraph(
  doc: Document,
  machine: VizMachine,
  callbacks: GraphOptions,
): SVGSVGElement | HTMLElement {
  const flow = flowFor(machine, callbacks);
  const layout = layoutOnce(machine, { flow });
  if (Either.isLeft(layout)) {
    return html(doc, "p", { class: "load-error", role: "alert" }, [`Cannot draw ${machine.id}.`]);
  }
  const { layout: placed, overlaps } = layout[1];
  const units = placed.width;
  const width = Math.ceil(units);
  const height = Math.ceil(placed.height);
  const root = svg(
    doc,
    "svg",
    {
      class: "graph",
      viewBox: `0 0 ${width} ${height}`,
      // Natural size; graphWidth clamps the drawn width.
      width,
      height,
      style: graphWidth(units, { flow }),
      role: "group",
      "aria-label": `machine ${machine.id}`,
      "data-flow": flow,
      ...(overlaps.length === 0 ? {} : { "data-overlaps": overlaps.length }),
    },
    [
      defs(doc),
      ...placed.regions.map((region) =>
        regionGroup(doc, region, machine.maps.includes(region.region)),
      ),
      ...placed.messages.map((message) => messageGroup(doc, message)),
      ...placed.edges.flatMap((edge) => [
        edgeGroup(doc, edge, { machine, callbacks }),
        ...(callbacks.details === undefined
          ? []
          : [helpGroup(doc, { placed: edge, details: callbacks.details, machine })]),
      ]),
      ...placed.entries.map((entry) => entryArrow(doc, entry)),
      ...placed.nodes.map((node) => nodeGroup(node, { doc, callbacks, drawn: machine })),
    ],
  );
  return root;
}

/** Board pixels per unit: a canvas of `w` px is laid out `w / 0.9` units wide, so names read at 10.8 px or more. */
export const BOARD_PX_PER_UNIT = 0.9;

/** The machines of a big board as named boxes, dotted wires between those that message each other. */
export function renderBoard(
  doc: Document,
  machine: VizMachine,
  context: { width: number; open: (part: string) => void },
): SVGSVGElement {
  const board = placeBoard(machine, context.width);
  const wires = board.wires.map((wire) =>
    svg(
      doc,
      "g",
      {
        class: "message",
        "aria-hidden": "true",
        "data-message-from": wire.from,
        "data-message-to": wire.to,
      },
      [
        svg(doc, "path", {
          d: wire.path,
          "marker-end": "url(#viz-arrow)",
          "marker-start": wire.both ? "url(#viz-arrow)" : null,
          style: `--viz-dot-gap: ${wire.dotGap}`,
        }),
      ],
    ),
  );
  const boxes = board.parts.map((placed) => {
    const group = svg(
      doc,
      "g",
      { class: "part", "data-part": placed.part, "aria-label": `machine ${placed.name}` },
      [
        svg(doc, "rect", {
          x: placed.x - placed.width / 2,
          y: placed.y - placed.height / 2,
          width: placed.width,
          height: placed.height,
          rx: 10,
        }),
        svg(doc, "text", { x: placed.x, y: placed.y + 4, "text-anchor": "middle" }, [placed.name]),
      ],
    );
    activatable(group, () => context.open(placed.part));
    return group;
  });
  return svg(
    doc,
    "svg",
    {
      class: "graph board",
      viewBox: `0 0 ${Math.ceil(board.width)} ${Math.ceil(board.height)}`,
      width: Math.ceil(board.width),
      height: Math.ceil(board.height),
      style: graphWidth(board.width, { flow: "across" }),
      role: "group",
      "aria-label": `machine ${machine.id}: ${board.parts.length} machines`,
    },
    [defs(doc), ...wires, ...boxes],
  );
}
