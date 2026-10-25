import type { AtlasMachine } from "../schema.ts";
import { activatable, svg } from "./dom.ts";
import { layoutMachine } from "./layout.ts";
import type { PlacedEdge, PlacedRegion, PlacedState, PlacedUnknown } from "./layout.ts";
import type { Point } from "@dagrejs/dagre";

export type Selection = { kind: "edge"; id: string } | { kind: "state"; id: string };

export interface GraphCallbacks {
  select(selection: Selection): void;
}

function isUnreached(coverage: { hits: number } | null): boolean {
  return coverage !== null && coverage.hits === 0;
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
        id: "atlas-arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      },
      [svg(doc, "path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head" })],
    ),
  ]);
}

function regionGroup(doc: Document, placed: PlacedRegion): SVGGElement {
  return svg(doc, "g", { class: "region", "data-region": placed.region }, [
    svg(doc, "rect", {
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
      width: placed.width,
      height: placed.height,
      rx: 10,
    }),
    svg(doc, "text", { x: placed.x - placed.width / 2 + 8, y: placed.y - placed.height / 2 + 14 }, [
      placed.region,
    ]),
  ]);
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
        unreached: isUnreached(state.coverage),
      }),
      "data-node-id": state.id,
      "aria-label": `state ${state.id}${state.final ? " (final)" : ""}`,
    },
    [
      svg(doc, "rect", { ...frame, class: "frame" }),
      state.final
        ? svg(doc, "rect", {
            x: left + 4,
            y: top + 4,
            width: placed.width - 8,
            height: placed.height - 8,
            rx: 5,
            class: "frame inner",
          })
        : null,
      svg(doc, "text", { x: placed.x, y: placed.y + 4, "text-anchor": "middle" }, [state.label]),
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

function edgeGroup(
  doc: Document,
  placed: PlacedEdge,
  context: { machine: AtlasMachine; callbacks: GraphCallbacks },
): SVGGElement {
  const { edge } = placed;
  const internal = context.machine.events.find((event) => event.id === edge.event)?.internal;
  // v1 effect edges carry the state name, not the effect name: label them generically.
  const text = edge.kind === "effect" ? "effect" : edge.event;
  const group = svg(
    doc,
    "g",
    {
      class: classes({
        edge: true,
        effect: edge.kind === "effect",
        undetermined: edge.to === null,
        internal: internal === true,
        unreached: isUnreached(edge.coverage),
      }),
      "data-edge-id": edge.id,
      "data-from": edge.from,
      "data-to": placed.target,
      "aria-label": `${edge.from} on ${text} to ${edge.to ?? "undetermined"}`,
    },
    [
      svg(doc, "path", { d: placed.path, "marker-end": "url(#atlas-arrow)" }),
      svg(doc, "text", { x: placed.label.x, y: placed.label.y + 4, "text-anchor": "middle" }, [
        text,
      ]),
    ],
  );
  activatable(group, () => context.callbacks.select({ kind: "edge", id: edge.id }));
  return group;
}

function entryArrow(doc: Document, entry: { from: Point; to: Point }): SVGGElement {
  return svg(doc, "g", { class: "entry", "aria-hidden": "true" }, [
    svg(doc, "circle", { cx: entry.from.x, cy: entry.from.y, r: 4 }),
    svg(doc, "path", {
      d: `M${entry.from.x},${entry.from.y} L${entry.to.x},${entry.to.y}`,
      "marker-end": "url(#atlas-arrow)",
    }),
  ]);
}

/** Toggle `highlight` on an edge and both of its endpoints while hovered. */
function wireHover(root: SVGSVGElement): void {
  for (const edge of root.querySelectorAll<SVGGElement>(".edge")) {
    const ends = new Set([edge.dataset["from"], edge.dataset["to"]]);
    const endpoints = () =>
      [...root.querySelectorAll<SVGGElement>("[data-node-id]")].filter((node) =>
        ends.has(node.dataset["nodeId"]),
      );
    edge.addEventListener("mouseenter", () => {
      for (const element of [edge, ...endpoints()]) element.classList.add("highlight");
    });
    edge.addEventListener("mouseleave", () => {
      for (const element of [edge, ...endpoints()]) element.classList.remove("highlight");
    });
  }
}

/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. */
export function renderGraph(
  doc: Document,
  machine: AtlasMachine,
  callbacks: GraphCallbacks,
): SVGSVGElement {
  const placed = layoutMachine(machine);
  const root = svg(
    doc,
    "svg",
    {
      class: "graph",
      viewBox: `0 0 ${Math.ceil(placed.width)} ${Math.ceil(placed.height)}`,
      // Scales down to fit the canvas; never up past natural size.
      style: `max-width: ${Math.ceil(placed.width)}px`,
      role: "group",
      "aria-label": `machine ${machine.id}`,
    },
    [
      defs(doc),
      ...placed.regions.map((region) => regionGroup(doc, region)),
      ...placed.edges.map((edge) => edgeGroup(doc, edge, { machine, callbacks })),
      placed.entry ? entryArrow(doc, placed.entry) : null,
      ...placed.nodes.map((node) =>
        node.kind === "state" ? stateGroup(doc, node, callbacks) : unknownGroup(doc, node),
      ),
    ],
  );
  wireHover(root);
  return root;
}
