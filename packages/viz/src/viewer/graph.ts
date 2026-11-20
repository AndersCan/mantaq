import { isAnyState } from "../schema.ts";
import type { VizEdge, VizMachine } from "../schema.ts";
import { activatable, html, svg } from "./dom.ts";
import { localName } from "./compartments.ts";
import { edgeCondition, edgeLines } from "./labels.ts";
import { ARROW_SIZE, FINAL_INSET } from "./geometry.ts";
import { HELP_SLOT, layoutMachine, textWidth } from "./layout.ts";
import { Either } from "@mantaq/utils";
import type {
  PlacedAny,
  PlacedEdge,
  PlacedMessage,
  PlacedRegion,
  PlacedState,
  PlacedUnknown,
} from "./layout.ts";
import type { Point } from "@dagrejs/dagre";
import { placeBoard } from "./board.ts";

export type Selection = { kind: "edge"; id: string } | { kind: "state"; id: string };

export interface GraphCallbacks {
  select(selection: Selection): void;
  /** Opens an arrow's Details without sending. Absent: no `?` is drawn (diagram-only). */
  details?: (edgeId: string) => void;
}

function sourceText(from: string): string {
  return isAnyState(from) ? "any state" : from;
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

function chipGroups(doc: Document, placed: PlacedState): SVGGElement[] {
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

function stateGroup(doc: Document, placed: PlacedState, callbacks: GraphCallbacks): SVGGElement {
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
      ...chipGroups(doc, placed),
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
  activatable(group, () => callbacks.select({ kind: "state", id: state.id }));
  return group;
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

function anyAria(placed: PlacedAny): string {
  if (placed.states.length === 0) return "any non-final state (onAny handlers)";
  if (placed.label === "any state") return "any state";
  return `these ${placed.states.length} states: ${placed.states.map(localName).join(", ")}`;
}

function anyGroup(doc: Document, placed: PlacedAny): SVGGElement {
  return svg(
    doc,
    "g",
    {
      class: "any-node",
      "data-node-id": placed.id,
      "data-states": placed.states.length === 0 ? null : JSON.stringify(placed.states),
      "aria-label": anyAria(placed),
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

function nodeGroup(
  doc: Document,
  node: PlacedState | PlacedUnknown | PlacedAny,
  callbacks: GraphCallbacks,
): SVGGElement {
  if (node.kind === "state") return stateGroup(doc, node, callbacks);
  return node.kind === "any" ? anyGroup(doc, node) : unknownGroup(doc, node);
}

const LINE_HEIGHT = 16;

function edgeAria(edge: VizEdge, text: string, members?: ReadonlyArray<string>): string {
  if (members !== undefined)
    return `${members.length} states on ${text} to ${edge.to ?? "undetermined"}${whenText(edge)}`;
  if (edge.kind === "stay") return `${sourceText(edge.from)} on ${text} stays`;
  return `${sourceText(edge.from)} on ${text} to ${edge.to ?? "undetermined"}${whenText(edge)}`;
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
  const text = edge.event;
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
      "aria-label": edgeAria(edge, text, placed.members),
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
  activatable(group, () => context.callbacks.select({ kind: "edge", id: edge.id }));
  return group;
}

/** The `?` beside an arrow's label: opens its Details, never sends. */
function helpGroup(doc: Document, placed: PlacedEdge, details: (id: string) => void): SVGGElement {
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
      "aria-label": `Details of ${edgeAria(placed.edge, placed.edge.event, placed.members)}`,
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
 * machine too wide for the floor scrolls sideways by the reader's hand.
 */
function graphWidth(units: number): string {
  const size = (scale: number) => ((units * scale) / LABEL_UNITS).toFixed(2);
  return `--graph-floor: ${size(LABEL_FLOOR_REM)}rem; width: clamp(var(--graph-floor), 100%, ${size(LABEL_CAP_EM)}em)`;
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

/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. */
export function renderGraph(
  doc: Document,
  machine: VizMachine,
  callbacks: GraphCallbacks,
): SVGSVGElement | HTMLElement {
  const layout = layoutMachine(machine);
  if (Either.isLeft(layout)) {
    return html(doc, "p", { class: "load-error", role: "alert" }, [`Cannot draw ${machine.id}.`]);
  }
  const placed = layout[1];
  const root = svg(
    doc,
    "svg",
    {
      class: "graph",
      viewBox: `0 0 ${Math.ceil(placed.width)} ${Math.ceil(placed.height)}`,
      // Natural size; graphWidth clamps the drawn width.
      width: Math.ceil(placed.width),
      height: Math.ceil(placed.height),
      style: graphWidth(placed.width),
      role: "group",
      "aria-label": `machine ${machine.id}`,
    },
    [
      defs(doc),
      ...placed.regions.map((region) =>
        regionGroup(doc, region, machine.maps.includes(region.region)),
      ),
      ...placed.messages.map((message) => messageGroup(doc, message)),
      ...placed.edges.flatMap((edge) => [
        edgeGroup(doc, edge, { machine, callbacks }),
        ...(callbacks.details === undefined ? [] : [helpGroup(doc, edge, callbacks.details)]),
      ]),
      ...placed.entries.map((entry) => entryArrow(doc, entry)),
      ...placed.nodes.map((node) => nodeGroup(doc, node, callbacks)),
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
      style: graphWidth(board.width),
      role: "group",
      "aria-label": `machine ${machine.id}: ${board.parts.length} machines`,
    },
    [defs(doc), ...wires, ...boxes],
  );
}
