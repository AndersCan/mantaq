import type { VizLiveChild, VizMachine } from "../schema.ts";
import { localName } from "./compartments.ts";
import { svg } from "./dom.ts";

export interface MarkerContext {
  machine: VizMachine;
  children: ReadonlyArray<VizLiveChild>;
  picked: { map: string; key: string } | null;
  /** True only right after a step or an effect result: moves slide, new markers grow in. */
  motion: boolean;
  onPick(child: { map: string; key: string } | null): void;
}

const PILL_H = 14;
const PILL_PAD = 10;
const CHAR = 6;
const GAP = 4;
const MAX_PILLS = 6;
const MAX_LABEL = 8;
const DOT_R = 4;
const DOT_STEP = 12;
const INSET = 16;
const MOVE_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

interface Item {
  child: VizLiveChild;
  dot: boolean;
  width: number;
  left: number;
  cy: number;
  state: string;
}

interface Live {
  context: MarkerContext;
  /** Marker elements in children order, for arrow keys. */
  order: SVGGElement[];
  elements: Map<string, SVGElement>;
  kept: Map<SVGElement, Item>;
}

const layers = new WeakMap<SVGGElement, Live>();

function label(key: string): string {
  if (key === "") return '""';
  return key.length > MAX_LABEL ? `${key.slice(0, MAX_LABEL - 1)}…` : key;
}

function idOf(child: { map: string; key: string }): string {
  return `${child.map}\0${child.key}`;
}

function layerOf(svgRoot: SVGSVGElement): SVGGElement {
  const found = Array.from(svgRoot.children).find((each) =>
    each.classList.contains("child-markers"),
  );
  if (found instanceof SVGGElement) return found;
  const layer = svg(svgRoot.ownerDocument, "g", {
    class: "child-markers",
    role: "group",
    "aria-label": "children",
  });
  svgRoot.append(layer);
  return layer;
}

function frameOf(svgRoot: SVGSVGElement, state: string): Element | null {
  return svgRoot.querySelector(`g[data-node-id="${CSS.escape(state)}"] > rect.frame:not(.inner)`);
}

function rowFor(
  children: ReadonlyArray<VizLiveChild>,
  frame: Element,
): { items: Array<Omit<Item, "state">>; count: number | null; countLeft: number } {
  const num = (name: string) => Number(frame.getAttribute(name));
  const inner = num("width") - INSET;
  const widths = children.map((child) => label(child.key).length * CHAR + PILL_PAD);
  const total = widths.reduce((sum, w) => sum + w, 0) + GAP * (children.length - 1);
  const centre = num("x") + num("width") / 2;
  const cy = num("y") + num("height") - 12;
  if (children.length <= MAX_PILLS && total <= inner) {
    const start = centre - total / 2;
    let at = start;
    const items = children.map((child, index) => {
      const width = widths[index] ?? 0;
      const item = { child, dot: false, width, left: at, cy };
      at += width + GAP;
      return item;
    });
    return { items, count: null, countLeft: 0 };
  }
  const countWidth = String(children.length).length * CHAR + GAP;
  const capacity = Math.max(1, Math.floor((inner - countWidth) / DOT_STEP));
  const shown = children.slice(0, capacity);
  const start = centre - (shown.length * DOT_STEP + countWidth) / 2;
  const items = shown.map((child, index) => ({
    child,
    dot: true,
    width: DOT_STEP,
    left: start + index * DOT_STEP,
    cy,
  }));
  return { items, count: children.length, countLeft: start + shown.length * DOT_STEP };
}

function shapeOf(doc: Document, item: Item): SVGElement[] {
  const text = label(item.child.key);
  if (item.dot) {
    return [
      svg(doc, "circle", { cx: DOT_R, cy: 0, r: DOT_R }),
      svg(doc, "rect", { class: "hit", x: -2, y: -PILL_H / 2, width: DOT_STEP, height: PILL_H }),
      svg(doc, "text", { class: "marker-key", x: DOT_R, y: 22, "text-anchor": "middle" }, [text]),
    ];
  }
  return [
    svg(doc, "rect", { x: 0, y: -PILL_H / 2, width: item.width, height: PILL_H, rx: PILL_H / 2 }),
    svg(doc, "text", { x: item.width / 2, y: 3.5, "text-anchor": "middle" }, [text]),
  ];
}

function samePick(
  picked: { map: string; key: string } | null,
  child: { map: string; key: string },
): boolean {
  return picked?.map === child.map && picked.key === child.key;
}

function targetOf(key: string, at: number, last: number): number {
  if (key === "Home") return 0;
  if (key === "End") return last;
  const forward = key === "ArrowRight" || key === "ArrowDown";
  return Math.min(last, Math.max(0, at + (forward ? 1 : -1)));
}

function moveFocus(live: Live, from: SVGGElement, key: string): void {
  const target = live.order[targetOf(key, live.order.indexOf(from), live.order.length - 1)];
  for (const each of live.order) each.setAttribute("tabindex", each === target ? "0" : "-1");
  target?.focus({ preventScroll: true });
}

function wire(marker: SVGGElement, live: Live): void {
  const act = () => {
    const item = live.kept.get(marker);
    if (item === undefined) return;
    const { picked } = live.context;
    live.context.onPick(
      samePick(picked, item.child) ? null : { map: item.child.map, key: item.child.key },
    );
  };
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    act();
  });
  marker.addEventListener("keydown", (event) => {
    if (!("key" in event)) return;
    const isMove = MOVE_KEYS.includes(event.key);
    if (!isMove && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (isMove) moveFocus(live, marker, event.key);
    else act();
  });
}

type Wanted = { item: Item } | { count: number; left: number; cy: number };

function wantedMarkers(svgRoot: SVGSVGElement, children: ReadonlyArray<VizLiveChild>) {
  const byState = new Map<string, VizLiveChild[]>();
  for (const child of children) {
    byState.set(child.state, [...(byState.get(child.state) ?? []), child]);
  }
  const wanted = new Map<string, Wanted>();
  for (const [state, group] of byState) {
    const frame = frameOf(svgRoot, state);
    if (frame === null) continue;
    const row = rowFor(group, frame);
    for (const item of row.items) wanted.set(idOf(item.child), { item: { ...item, state } });
    const [first] = row.items;
    if (row.count !== null && first !== undefined) {
      wanted.set(`count:${state}`, { count: row.count, left: row.countLeft, cy: first.cy });
    }
  }
  return wanted;
}

function place(element: SVGElement, at: { left: number; cy: number }): void {
  (element as SVGElement & ElementCSSInlineStyle).style.transform =
    `translate(${at.left.toFixed(1)}px, ${at.cy.toFixed(1)}px)`;
}

function drawCount(
  live: Live,
  layer: SVGGElement,
  id: string,
  entry: { count: number; left: number; cy: number },
) {
  const existing = live.elements.get(id);
  const text =
    existing ??
    svg(layer.ownerDocument, "text", {
      class: "marker-count",
      x: 0,
      y: 3.5,
      "aria-hidden": "true",
    });
  text.setAttribute("data-marker-count", String(entry.count));
  text.textContent = String(entry.count);
  place(text, entry);
  if (existing === undefined) {
    live.elements.set(id, text);
    layer.append(text);
  }
}

function drawMarker(live: Live, layer: SVGGElement, item: Item): void {
  const { context } = live;
  const doc = layer.ownerDocument;
  const id = idOf(item.child);
  const final = context.machine.states.some((each) => each.id === item.state && each.final);
  const existing = live.elements.get(id);
  const marker = existing instanceof SVGGElement ? existing : svg(doc, "g", { role: "button" });
  if (existing === undefined) {
    wire(marker, live);
    live.elements.set(id, marker);
    layer.append(marker);
  }
  live.kept.set(marker, item);
  const named = item.child.key === "" ? '""' : item.child.key;
  const entering = existing === undefined && context.motion;
  marker.setAttribute(
    "class",
    ["child-marker", item.dot && "dot", final && "final", entering && "entering"]
      .filter(Boolean)
      .join(" "),
  );
  marker.setAttribute("data-marker-map", item.child.map);
  marker.setAttribute("data-marker-key", item.child.key);
  marker.setAttribute("data-marker-state", item.state);
  marker.setAttribute("aria-pressed", String(samePick(context.picked, item.child)));
  marker.setAttribute("aria-label", `${named}, in ${localName(item.state)}`);
  place(marker, item);
  marker.replaceChildren(svg(doc, "title", {}, [named]), ...shapeOf(doc, item));
}

function forgetGone(live: Live, wanted: ReadonlyMap<string, Wanted>): void {
  for (const [id, element] of live.elements) {
    if (wanted.has(id)) continue;
    element.remove();
    live.elements.delete(id);
    if (element instanceof SVGGElement) live.kept.delete(element);
  }
}

/** Exactly one marker is in the tab order: the one that had it, else the picked one, else the first. */
function rove(live: Live, previous: SVGGElement | undefined): void {
  const { picked } = live.context;
  const roving =
    live.order.find((each) => each === previous) ??
    live.order.find(
      (each) =>
        picked !== null &&
        each.getAttribute("data-marker-key") === picked.key &&
        each.getAttribute("data-marker-map") === picked.map,
    ) ??
    live.order[0];
  for (const each of live.order) each.setAttribute("tabindex", each === roving ? "0" : "-1");
}

/** Draws one marker per child in a layer kept on `svg` across calls, keyed `map\0key`. */
export function drawChildMarkers(svgRoot: SVGSVGElement, context: MarkerContext): void {
  const layer = layerOf(svgRoot);
  layer.classList.toggle("still", !context.motion);
  const live: Live = layers.get(layer) ?? {
    context,
    order: [],
    elements: new Map(),
    kept: new Map(),
  };
  live.context = context;
  layers.set(layer, live);
  const previous = live.order.find((each) => each.getAttribute("tabindex") === "0");
  const wanted = wantedMarkers(svgRoot, context.children);
  forgetGone(live, wanted);
  for (const [id, entry] of wanted) {
    if ("count" in entry) drawCount(live, layer, id, entry);
    else drawMarker(live, layer, entry.item);
  }
  live.order = context.children
    .map((child) => live.elements.get(idOf(child)))
    .filter((each): each is SVGGElement => each instanceof SVGGElement);
  rove(live, previous);
}
