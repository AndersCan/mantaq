import type { VizLiveChild } from "../schema.ts";
import { compareKeys, localName } from "./compartments.ts";
import { svg } from "./dom.ts";
import { textWidth } from "./layout.ts";

export interface MarkerContext {
  children: ReadonlyArray<VizLiveChild>;
  picked: { map: string; key: string } | null;
  onPick(child: { map: string; key: string }): void;
}

const PILL_H = 14;
const PILL_PAD = 10;
const FONT = 10;
const GAP = 4;
const MAX_LABEL = 8;

interface Row {
  left: number;
  width: number;
  cy: number;
}

interface Item {
  child: VizLiveChild;
  width: number;
  left: number;
  cy: number;
  state: string;
}

interface Count {
  map: string;
  state: string;
  hidden: string[];
  left: number;
  cy: number;
}

interface Live {
  context: MarkerContext;
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

function rowOf(svgRoot: SVGSVGElement, state: string): Row | null {
  const rect = svgRoot.querySelector(`g[data-node-id="${CSS.escape(state)}"] > rect.worker-row`);
  if (rect === null) return null;
  const num = (name: string) => Number(rect.getAttribute(name));
  return { left: num("x"), width: num("width"), cy: num("y") + num("height") / 2 };
}

function chipsOf(
  children: ReadonlyArray<VizLiveChild>,
  row: Row,
): { items: Item[]; count: Count | null } {
  const widths = children.map((child) => textWidth(label(child.key), FONT) + PILL_PAD);
  const usedBy = (shown: number) => {
    const rest = children.length - shown;
    const pills = widths.slice(0, shown).reduce((sum, w) => sum + w, 0) + GAP * (shown - 1);
    if (rest === 0) return pills;
    return pills + GAP + textWidth(`+${rest}`, FONT);
  };
  let shown = children.length;
  while (shown > 0 && usedBy(shown) > row.width) shown -= 1;
  let at = row.left + (row.width - usedBy(shown)) / 2;
  const items = children.slice(0, shown).map((child, index) => {
    const width = widths[index] ?? 0;
    const item = { child, width, left: at, cy: row.cy, state: "" };
    at += width + GAP;
    return item;
  });
  const hidden = children.slice(shown).map((child) => child.key);
  const count = hidden.length > 0 ? { map: "", state: "", hidden, left: at, cy: row.cy } : null;
  return { items, count };
}

function shapeOf(doc: Document, item: Item): SVGElement[] {
  return [
    svg(doc, "rect", { x: 0, y: -PILL_H / 2, width: item.width, height: PILL_H, rx: PILL_H / 2 }),
    svg(doc, "text", { x: item.width / 2, y: 3.5, "text-anchor": "middle" }, [
      label(item.child.key),
    ]),
  ];
}

function wire(marker: SVGGElement, live: Live): void {
  const act = () => {
    const item = live.kept.get(marker);
    if (item === undefined) return;
    live.context.onPick({ map: item.child.map, key: item.child.key });
  };
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    act();
  });
  marker.addEventListener("keydown", (event) => {
    if (!("key" in event) || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  });
}

type Wanted = { item: Item } | { count: Count };

function wantedMarkers(svgRoot: SVGSVGElement, children: ReadonlyArray<VizLiveChild>) {
  const byState = new Map<string, VizLiveChild[]>();
  for (const child of [...children].sort((a, b) => compareKeys(a.key, b.key))) {
    byState.set(child.state, [...(byState.get(child.state) ?? []), child]);
  }
  const wanted = new Map<string, Wanted>();
  for (const [state, group] of byState) {
    const row = rowOf(svgRoot, state);
    if (row === null) continue;
    const { items, count } = chipsOf(group, row);
    for (const item of items) wanted.set(idOf(item.child), { item: { ...item, state } });
    if (count !== null)
      wanted.set(`count:${state}`, { count: { ...count, map: group[0]?.map ?? "", state } });
  }
  return wanted;
}

function place(element: SVGElement, at: { left: number; cy: number }): void {
  (element as SVGElement & ElementCSSInlineStyle).style.transform =
    `translate(${at.left.toFixed(1)}px, ${at.cy.toFixed(1)}px)`;
}

function drawCount(live: Live, layer: SVGGElement, id: string, count: Count): void {
  const doc = layer.ownerDocument;
  const existing = live.elements.get(id);
  const text =
    existing ?? svg(doc, "text", { class: "marker-count", x: 0, y: 3.5, "aria-hidden": "true" });
  text.replaceChildren(
    svg(doc, "title", {}, [count.hidden.join("\n")]),
    doc.createTextNode(`+${count.hidden.length}`),
  );
  text.setAttribute("data-marker-map", count.map);
  text.setAttribute("data-marker-state", count.state);
  place(text, count);
  if (existing === undefined) {
    live.elements.set(id, text);
    layer.append(text);
  }
}

function drawMarker(live: Live, layer: SVGGElement, item: Item): void {
  const { context } = live;
  const doc = layer.ownerDocument;
  const id = idOf(item.child);
  const existing = live.elements.get(id);
  const marker =
    existing instanceof SVGGElement ? existing : svg(doc, "g", { role: "button", tabindex: "0" });
  if (existing === undefined) {
    wire(marker, live);
    live.elements.set(id, marker);
    layer.append(marker);
  }
  live.kept.set(marker, item);
  const named = item.child.key === "" ? '""' : item.child.key;
  marker.setAttribute("class", "child-marker");
  marker.setAttribute("data-marker-map", item.child.map);
  marker.setAttribute("data-marker-key", item.child.key);
  marker.setAttribute("data-marker-state", item.state);
  marker.setAttribute(
    "aria-pressed",
    String(context.picked?.map === item.child.map && context.picked.key === item.child.key),
  );
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

/** Draws one marker per child in a layer kept on `svgRoot` across calls, keyed `map\0key`. */
export function drawChildMarkers(svgRoot: SVGSVGElement, context: MarkerContext): void {
  const layer = layerOf(svgRoot);
  const live: Live = layers.get(layer) ?? { context, elements: new Map(), kept: new Map() };
  live.context = context;
  layers.set(layer, live);
  const wanted = wantedMarkers(svgRoot, context.children);
  forgetGone(live, wanted);
  for (const [id, entry] of wanted) {
    if ("count" in entry) drawCount(live, layer, id, entry.count);
    else drawMarker(live, layer, entry.item);
  }
}
