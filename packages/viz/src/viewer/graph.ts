import { machineFindings } from "../findings.ts";
import type { VizFinding } from "../findings.ts";
import { isAnyState } from "../schema.ts";
import { movesFrom } from "../moves.ts";
import type { VizCoverage, VizEdge, VizMachine } from "../schema.ts";
import { measure } from "./coverage-mode.ts";
import type { CoverageMode } from "./coverage-mode.ts";
import { activatable, svg } from "./dom.ts";
import { edgeText } from "./labels.ts";
import { layoutMachine } from "./layout.ts";
import type { PlacedAny, PlacedEdge, PlacedRegion, PlacedState, PlacedUnknown } from "./layout.ts";
import type { Point } from "@dagrejs/dagre";

export type Selection = { kind: "edge"; id: string } | { kind: "state"; id: string };

export interface GraphCallbacks {
  select(selection: Selection): void;
  /** Show the details of a selection without taking a step. */
  showDetails(selection: Selection, options?: { findings: boolean }): void;
  /** Coverage source the overlay dims by. */
  mode: CoverageMode;
}

function sourceText(from: string): string {
  return isAnyState(from) ? "any state" : from;
}

function isUnreached(coverage: VizCoverage | null): boolean {
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
    svg(
      doc,
      "marker",
      {
        id: "viz-arrow-loop",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
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
      svg(
        doc,
        "text",
        { x: placed.x - placed.width / 2 + 8, y: placed.y - placed.height / 2 + 14 },
        [isMap ? `${placed.region}: one per key` : placed.region],
      ),
    ],
  );
}

function chipGroups(doc: Document, placed: PlacedState): SVGGElement[] {
  const top = placed.y - placed.height / 2;
  const width = placed.width - 16;
  return placed.state.effects.map((effect, index) => {
    const y = top + 36 + index * 20 - 8;
    return svg(
      doc,
      "g",
      {
        class: "chip",
        "data-effect": effect.name,
        "data-state": placed.state.id,
        tabindex: 0,
        "aria-label":
          effect.sends === null
            ? `effect ${effect.name} (declare sends to see links)`
            : `effect ${effect.name}`,
      },
      [
        svg(doc, "rect", { x: placed.x - width / 2, y, width, height: 16, rx: 8 }),
        svg(doc, "text", { x: placed.x, y: y + 12, "text-anchor": "middle" }, [effect.name]),
        effect.sends === null
          ? svg(
              doc,
              "text",
              { class: "hint", x: placed.x + width / 2 - 8, y: y + 12, "text-anchor": "middle" },
              ["?", svg(doc, "title", {}, ["declare `sends` to see links"])],
            )
          : null,
      ],
    );
  });
}

function findingMark(
  doc: Document,
  placed: PlacedState,
  context: { findings: ReadonlyArray<VizFinding>; callbacks: GraphCallbacks },
): SVGGElement {
  const { findings, callbacks } = context;
  const id = placed.state.id;
  const cx = placed.x + placed.width / 2 - 2;
  const cy = placed.y - placed.height / 2 + 2;
  const titles = findings.map((finding) => finding.title).join("; ");
  const noun = findings.length === 1 ? "finding" : "findings";
  const mark = svg(
    doc,
    "g",
    {
      class: "finding-mark",
      "data-finding-count": findings.length,
      "data-state": id,
      tabindex: 0,
      role: "button",
      "aria-label": `${findings.length} ${noun} on ${id}: ${titles}`,
    },
    [
      svg(doc, "circle", { cx, cy, r: 8 }),
      svg(doc, "text", { x: cx, y: cy + 4, "text-anchor": "middle" }, ["!"]),
    ],
  );
  const open = () => callbacks.showDetails({ kind: "state", id }, { findings: true });
  mark.addEventListener("click", (event) => {
    event.stopPropagation();
    open();
  });
  mark.addEventListener("keydown", (event) => {
    if (!("key" in event) || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  return mark;
}

function stateGroup(
  doc: Document,
  placed: PlacedState,
  context: { callbacks: GraphCallbacks; findings: ReadonlyArray<VizFinding> },
): SVGGElement {
  const { callbacks, findings } = context;
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
        unreached: isUnreached(measure(callbacks.mode, state)),
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
      svg(doc, "text", { x: placed.x, y: top + 22, "text-anchor": "middle" }, [state.label]),
      ...chipGroups(doc, placed),
      findings.length === 0 ? null : findingMark(doc, placed, { findings, callbacks }),
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
  context: { callbacks: GraphCallbacks; findings: ReadonlyMap<string, VizFinding[]> },
): SVGGElement {
  if (node.kind === "state") {
    const findings = context.findings.get(node.state.id) ?? [];
    return stateGroup(doc, node, { callbacks: context.callbacks, findings });
  }
  return node.kind === "any" ? anyGroup(doc, node) : unknownGroup(doc, node);
}

function edgeAria(edge: VizEdge, text: string): string {
  if (edge.kind === "stay") return `${sourceText(edge.from)} on ${text} stays`;
  return `${sourceText(edge.from)} on ${text} to ${edge.to ?? "undetermined"}`;
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
        fuzz: edge.origin === "fuzz",
        undetermined: edge.to === null,
        internal: internal === true,
        unreached: isUnreached(measure(context.callbacks.mode, edge)),
      }),
      "data-edge-id": edge.id,
      "data-from": edge.from,
      "data-to": placed.target,
      "aria-label": edgeAria(edge, text),
    },
    [
      svg(doc, "path", {
        d: placed.path,
        "marker-end":
          placed.edge.from === placed.target ? "url(#viz-arrow-loop)" : "url(#viz-arrow)",
        style:
          internal === true || edge.kind === "stay"
            ? `--viz-dot-gap: ${placed.dotGap.toFixed(1)}`
            : null,
      }),
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
    svg(doc, "circle", { cx: entry.from.x, cy: entry.from.y, r: 6 }),
    svg(doc, "path", {
      d: `M${entry.from.x},${entry.from.y} L${entry.to.x},${entry.to.y}`,
      "marker-end": "url(#viz-arrow)",
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

/** Edges a chip's effect sends, including `onAny` handlers, by edge id. */
function sentEdges(root: SVGSVGElement, machine: VizMachine, chip: SVGGElement): SVGGElement[] {
  const effect = chip.dataset["effect"] ?? "";
  const ids = new Set(
    movesFrom(machine, chip.dataset["state"] ?? "")
      .filter((move) => move.sentBy.includes(effect))
      .map((move) => move.edge.id),
  );
  return [...root.querySelectorAll<SVGGElement>(".edge")].filter((edge) =>
    ids.has(edge.dataset["edgeId"] ?? ""),
  );
}

/** Hovering or focusing a chip highlights the edges for its `sends` and dims the rest. */
function wireChips(root: SVGSVGElement, doc: Document, machine: VizMachine): void {
  const emitters = new Map<SVGGElement, string[]>();
  for (const chip of root.querySelectorAll<SVGGElement>(".chip")) {
    const edges = sentEdges(root, machine, chip);
    const effect = chip.dataset["effect"] ?? "";
    for (const edge of edges) emitters.set(edge, [...(emitters.get(edge) ?? []), effect]);
    const on = () => {
      if (edges.length === 0) return;
      root.classList.add("chip-active");
      for (const edge of edges) edge.classList.add("sent");
    };
    const off = () => {
      root.classList.remove("chip-active");
      for (const edge of edges) edge.classList.remove("sent");
    };
    chip.addEventListener("mouseenter", on);
    chip.addEventListener("mouseleave", off);
    chip.addEventListener("focusin", on);
    chip.addEventListener("focusout", off);
  }
  for (const [edge, names] of emitters) {
    edge.prepend(svg(doc, "title", {}, [`emitted by ${names.join(", ")}`]));
  }
}

/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. */
/** Label size in viewBox units (`.graph text`). */
const LABEL_UNITS = 12;

/**
 * Width relative to the viewer's text (em), so labels track it and the
 * reader's font settings: fills the canvas, labels between 0.85em and 1.4em.
 * Below the floor the canvas scrolls sideways rather than shrink unreadably.
 */
function graphWidth(units: number): string {
  const em = (scale: number) => `${((units * scale) / LABEL_UNITS).toFixed(2)}em`;
  return `width: clamp(${em(0.85)}, 100%, ${em(1.4)})`;
}

export function renderGraph(
  doc: Document,
  machine: VizMachine,
  callbacks: GraphCallbacks,
): SVGSVGElement {
  const placed = layoutMachine(machine);
  const findings = new Map<string, VizFinding[]>();
  for (const finding of machineFindings(machine)) {
    if (finding.state === null || finding.note) continue;
    findings.set(finding.state, [...(findings.get(finding.state) ?? []), finding]);
  }
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
      ...placed.nodes.map((node) => nodeGroup(doc, node, { callbacks, findings })),
    ],
  );
  wireHover(root);
  wireChips(root, doc, machine);
  return root;
}
