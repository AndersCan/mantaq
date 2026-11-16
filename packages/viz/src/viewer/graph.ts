import { isAnyState } from "../schema.ts";
import type { VizEdge, VizMachine } from "../schema.ts";
import { activatable, html, svg } from "./dom.ts";
import { edgeCondition, edgeLines, edgeText } from "./labels.ts";
import { ARROW_SIZE, FINAL_INSET } from "./geometry.ts";
import { layoutMachine } from "./layout.ts";
import { Either } from "@mantaq/utils";
import type { PlacedAny, PlacedEdge, PlacedRegion, PlacedState, PlacedUnknown } from "./layout.ts";
import type { Point } from "@dagrejs/dagre";

export type Selection = { kind: "edge"; id: string } | { kind: "state"; id: string };

export interface GraphCallbacks {
  select(selection: Selection): void;
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
    svg(
      doc,
      "marker",
      {
        id: "viz-arrow-loop",
        viewBox: "0 0 10 10",
        refX: 10,
        refY: 5,
        markerWidth: ARROW_SIZE,
        markerHeight: ARROW_SIZE,
        markerUnits: "userSpaceOnUse",
        orient: "auto-start-reverse",
      },
      [svg(doc, "path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head arrow-head-loop" })],
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
        isMap ? `${placed.region}: one per key` : placed.region,
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

function anyGroup(doc: Document, placed: PlacedAny): SVGGElement {
  return svg(
    doc,
    "g",
    {
      class: "any-node",
      "data-node-id": placed.id,
      "aria-label": "any non-final state (onAny handlers)",
    },
    [
      svg(doc, "rect", {
        x: placed.x - placed.width / 2,
        y: placed.y - placed.height / 2,
        width: placed.width,
        height: placed.height,
        rx: placed.height / 2,
      }),
      svg(doc, "text", { x: placed.x, y: placed.y + 4, "text-anchor": "middle" }, ["any state"]),
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

function edgeAria(edge: VizEdge, text: string): string {
  if (edge.kind === "stay") return `${sourceText(edge.from)} on ${text} stays`;
  const condition = edgeCondition(edge);
  const when = condition === null ? "" : ` when ${condition}`;
  return `${sourceText(edge.from)} on ${text} to ${edge.to ?? "undetermined"}${when}`;
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
  const text = edgeText(edge);
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
      "data-from": edge.from,
      "data-to": placed.target,
      "aria-label": edgeAria(edge, text),
    },
    [
      svg(doc, "path", { class: "hit", d: placed.path, "aria-hidden": "true" }),
      svg(doc, "path", {
        d: placed.path,
        "marker-end":
          placed.edge.from === placed.target ? "url(#viz-arrow-loop)" : "url(#viz-arrow)",
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
 * Fills the canvas on every surface; labels never drop under 0.6rem (about
 * 10px) nor grow past 1.4em. A machine too wide for that scrolls sideways by
 * the reader's hand.
 */
function graphWidth(units: number): string {
  const size = (scale: number) => ((units * scale) / LABEL_UNITS).toFixed(2);
  return `width: clamp(${size(LABEL_FLOOR_REM)}rem, 100%, ${size(LABEL_CAP_EM)}em)`;
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
      // Natural size; the standalone page scales to fit, embeds may scroll instead.
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
      ...placed.edges.map((edge) => edgeGroup(doc, edge, { machine, callbacks })),
      ...placed.entries.map((entry) => entryArrow(doc, entry)),
      ...placed.nodes.map((node) => nodeGroup(doc, node, callbacks)),
    ],
  );
  return root;
}
