import type { Point } from "@dagrejs/dagre";
import type { MachineLayout } from "./layout.ts";

type Part =
  | `label:${string}`
  | `path:${string}`
  | `arrow:${string}`
  | `node:${string}`
  | `region:${string}`
  | `title:${string}`
  | `entry:${string}`
  | "canvas";

export type Rule =
  | "label-clear"
  | "path-through-node"
  | "paths-alongside"
  | "arrowheads"
  | "nodes"
  | "region-edge"
  | "outside";

/** `gap` is the measured distance in px; negative means the boxes intersect. */
export interface Overlap {
  rule: Rule;
  a: Part;
  b: Part;
  gap: number;
}

/** Centre and size. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LABEL_PAD = 8;
const PATH_NODE_CLEAR = 4;
const STUB = 12;
const SAMPLE_STEP = 2;
const ALONGSIDE_GAP = 3;
const ALONGSIDE_RUN = 12;
const MARK_OVERHANG = 6;
const ARROW_SIZE = 8;

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function samplePolyline(points: ReadonlyArray<Point>): Point[] {
  const out: Point[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP)) || 1;
    for (let step = 0; step < steps; step++) {
      out.push({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      });
    }
  }
  const last = points.at(-1);
  if (last !== undefined) out.push(last);
  return out;
}

/** Points of an SVG path as written today: `M`/`L` lines and `C` Béziers sampled at t = 0.02 steps. */
export function pathPoints(path: string): Point[] {
  const tokens = path.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Point[] = [];
  let command = "M";
  let index = 0;
  const number = (): number => Number(tokens[index++]);
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "M" || token === "L" || token === "C") {
      command = token;
      index++;
    }
    if (command === "C") {
      const start = points.at(-1) ?? { x: 0, y: 0 };
      const c1 = { x: number(), y: number() };
      const c2 = { x: number(), y: number() };
      const end = { x: number(), y: number() };
      for (let step = 1; step <= 50; step++) {
        const t = step * 0.02;
        const u = 1 - t;
        points.push({
          x: u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x,
          y: u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y,
        });
      }
    } else {
      points.push({ x: number(), y: number() });
    }
  }
  return points;
}

function pointToBox(point: Point, box: Box): number {
  const dx = Math.max(Math.abs(point.x - box.x) - box.width / 2, 0);
  const dy = Math.max(Math.abs(point.y - box.y) - box.height / 2, 0);
  return Math.hypot(dx, dy);
}

/** Negative when the boxes intersect: minus the shallower overlap. */
function boxToBox(a: Box, b: Box): number {
  const dx = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  const dy = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
  return dx < 0 && dy < 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

function pathToBox(path: ReadonlyArray<Point>, box: Box): number {
  return Math.min(...path.map((point) => pointToBox(point, box)));
}

function pathToPath(a: ReadonlyArray<Point>, b: ReadonlyArray<Point>): number {
  let best = Infinity;
  for (const from of a)
    for (const to of b) best = Math.min(best, Math.hypot(from.x - to.x, from.y - to.y));
  return best;
}

function borderPoints(box: Box): Point[] {
  const left = box.x - box.width / 2;
  const top = box.y - box.height / 2;
  const corners = [
    { x: left, y: top },
    { x: left + box.width, y: top },
    { x: left + box.width, y: top + box.height },
    { x: left, y: top + box.height },
    { x: left, y: top },
  ];
  return samplePolyline(corners);
}

function arrowBox(path: ReadonlyArray<Point>): Box {
  const last = path.at(-1) ?? { x: 0, y: 0 };
  const before =
    path.findLast((point) => Math.hypot(point.x - last.x, point.y - last.y) >= 1) ?? last;
  const back = sub(before, last);
  const length = Math.hypot(back.x, back.y) || 1;
  return {
    x: last.x + (back.x / length) * (ARROW_SIZE / 2),
    y: last.y + (back.y / length) * (ARROW_SIZE / 2),
    width: ARROW_SIZE,
    height: ARROW_SIZE,
  };
}

/** Room between a box and the border of the box around it; negative when it sticks out. */
function insetIn(box: Box, outer: Box): number {
  return Math.min(
    outer.width / 2 - Math.abs(box.x - outer.x) - box.width / 2,
    outer.height / 2 - Math.abs(box.y - outer.y) - box.height / 2,
  );
}

/** Smallest `insetIn` over the points; NaN when any point is not a number (`Math.min` keeps NaN). */
function insetOfPoints(points: ReadonlyArray<Point>, outer: Box): number {
  let least = Infinity;
  for (const point of points) {
    const inset = insetIn({ x: point.x, y: point.y, width: 0, height: 0 }, outer);
    least = Math.min(least, inset);
  }
  return least;
}

function regionContains(region: string, owner: string | null): boolean {
  return owner !== null && (owner === region || owner.startsWith(`${region}.`));
}

/** The path without its first and last `STUB` px, measured along the path. */
function beyondStubs(path: ReadonlyArray<Point>): Point[] {
  const along: number[] = [0];
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1];
    const to = path[index];
    const step =
      from === undefined || to === undefined ? 0 : Math.hypot(to.x - from.x, to.y - from.y);
    along.push((along[index - 1] ?? 0) + step);
  }
  const total = along.at(-1) ?? 0;
  return path.filter((_, index) => {
    const at = along[index] ?? 0;
    return at > STUB && total - at > STUB;
  });
}

interface Shapes {
  nodes: Array<{ id: string; part: Part; box: Box; owner: string | null }>;
  edges: Array<{ id: string; from: string; target: string; path: Point[]; label: Box; arrow: Box }>;
  entries: Array<{ part: Part; line: Point[] }>;
  regions: Array<{
    part: Part;
    title: Part;
    name: string;
    box: Box;
    titleBox: Box;
    border: Point[];
  }>;
  canvas: Box;
}

type Add = (rule: Rule, a: Part, b: Part, gap: number) => void;

function shapesOf(layout: MachineLayout): Shapes {
  const grown = (kind: string) => (kind === "state" ? MARK_OVERHANG : 0);
  return {
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      part: `node:${node.id}`,
      box: {
        x: node.x + grown(node.kind) / 2,
        y: node.y - grown(node.kind) / 2,
        width: node.width + grown(node.kind),
        height: node.height + grown(node.kind),
      },
      owner: node.kind === "state" ? node.state.region : null,
    })),
    edges: layout.edges.map((placed) => {
      const path = samplePolyline(placed.points);
      return {
        id: placed.edge.id,
        from: placed.edge.from,
        target: placed.target,
        path,
        label: placed.label,
        arrow: arrowBox(path),
      };
    }),
    entries: layout.entries.map((entry, index) => ({
      part: `entry:${index}`,
      line: samplePolyline([entry.from, entry.to]),
    })),
    regions: layout.regions.map((region) => ({
      part: `region:${region.region}`,
      title: `title:${region.region}`,
      name: region.region,
      box: region,
      titleBox: region.title,
      border: borderPoints(region),
    })),
    canvas: {
      x: layout.width / 2,
      y: layout.height / 2,
      width: layout.width,
      height: layout.height,
    },
  };
}

type PlacedLabel = Shapes["edges"][number];

function labelOverlaps(one: PlacedLabel, rest: Shapes, add: Add): void {
  const part: Part = `label:${one.id}`;
  const near = (other: Part, gap: number): void => {
    if (gap < LABEL_PAD) add("label-clear", part, other, gap);
  };
  for (const other of rest.edges) {
    if (other.id > one.id) near(`label:${other.id}`, boxToBox(one.label, other.label));
    near(`path:${other.id}`, pathToBox(other.path, one.label));
    near(`arrow:${other.id}`, boxToBox(one.label, other.arrow));
  }
  for (const node of rest.nodes) near(node.part, boxToBox(one.label, node.box));
  for (const entry of rest.entries) near(entry.part, pathToBox(entry.line, one.label));
  for (const region of rest.regions) {
    near(region.part, pathToBox(region.border, one.label));
    near(region.title, boxToBox(one.label, region.titleBox));
  }
  const inset = insetIn(one.label, rest.canvas);
  if (!(inset >= 0)) add("outside", part, "canvas", inset);
}

function pathOverlaps(one: PlacedLabel, rest: Shapes, add: Add): void {
  const part: Part = `path:${one.id}`;
  for (const node of rest.nodes) {
    const own = node.id === one.from || node.id === one.target;
    const path = own ? beyondStubs(one.path) : one.path;
    const gap = pathToBox(path, node.box);
    if (gap < PATH_NODE_CLEAR) add("path-through-node", part, node.part, gap);
  }
  for (const entry of rest.entries) {
    const gap = pathToPath(one.path, entry.line);
    if (gap < PATH_NODE_CLEAR) add("path-through-node", part, entry.part, gap);
  }
  for (const region of rest.regions) {
    const gap = Math.min(
      pathToBox(one.path, region.titleBox),
      boxToBox(one.arrow, region.titleBox),
    );
    if (gap < PATH_NODE_CLEAR) add("path-through-node", part, region.title, gap);
  }
  const pathInset = insetOfPoints(one.path, rest.canvas);
  if (!(pathInset >= 0)) add("outside", part, "canvas", pathInset);
  const arrowInset = insetIn(one.arrow, rest.canvas);
  if (!(arrowInset >= 0)) add("outside", `arrow:${one.id}`, "canvas", arrowInset);
  for (const other of rest.edges.filter((each) => each.id > one.id))
    pairOverlaps(one, other, rest, add);
}

function pairOverlaps(one: PlacedLabel, other: PlacedLabel, rest: Shapes, add: Add): void {
  const arrowGap = boxToBox(one.arrow, other.arrow);
  if (arrowGap < 0) add("arrowheads", `arrow:${one.id}`, `arrow:${other.id}`, arrowGap);
  const shared = rest.nodes.some(
    (node) =>
      [one.from, one.target].includes(node.id) && [other.from, other.target].includes(node.id),
  );
  if (longestRun(shared ? beyondStubs(one.path) : one.path, other.path) > ALONGSIDE_RUN) {
    add("paths-alongside", `path:${one.id}`, `path:${other.id}`, 0);
  }
}

/** Length of the longest stretch of `path` within `ALONGSIDE_GAP` of `other`. */
function longestRun(path: ReadonlyArray<Point>, other: ReadonlyArray<Point>): number {
  let run = 0;
  let longest = 0;
  for (const point of path) {
    const near = other.some(
      (other) => Math.hypot(point.x - other.x, point.y - other.y) < ALONGSIDE_GAP,
    );
    run = near ? run + SAMPLE_STEP : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

function nodeOverlaps(shapes: Shapes, add: Add): void {
  for (const [index, node] of shapes.nodes.entries()) {
    for (const other of shapes.nodes.slice(index + 1)) {
      const gap = boxToBox(node.box, other.box);
      if (gap < LABEL_PAD) add("nodes", node.part, other.part, gap);
    }
    const inset = insetIn(node.box, shapes.canvas);
    if (!(inset >= 0)) add("outside", node.part, "canvas", inset);
    for (const region of shapes.regions) {
      const gap = regionContains(region.name, node.owner)
        ? insetIn(node.box, region.box)
        : boxToBox(node.box, region.box);
      if (gap < LABEL_PAD) add("region-edge", node.part, region.part, gap);
      const titleGap = boxToBox(node.box, region.titleBox);
      if (titleGap < LABEL_PAD) add("region-edge", node.part, region.title, titleGap);
    }
  }
}

/** The overlaps that involve one edge's label. */
export function labelOverlapsFor(layout: MachineLayout, edgeId: string): Overlap[] {
  const found: Overlap[] = [];
  const shapes = shapesOf(layout);
  const one = shapes.edges.find((edge) => edge.id === edgeId);
  if (one === undefined) return found;
  labelOverlaps(one, shapes, (rule, a, b, gap) => found.push({ rule, a, b, gap }));
  for (const other of shapes.edges) {
    if (other.id >= edgeId) continue;
    const gap = boxToBox(other.label, one.label);
    if (gap < LABEL_PAD)
      found.push({ rule: "label-clear", a: `label:${other.id}`, b: `label:${edgeId}`, gap });
  }
  return found;
}

/**
 * Every overlap in a layout, as plain data. Pure, never mutates, sorted by
 * (rule, a, b). Works on today's `MachineLayout`: Béziers are sampled and a
 * label's size comes from its text.
 */
export function overlapsOf(layout: MachineLayout): Overlap[] {
  const found: Overlap[] = [];
  const add: Add = (rule, a, b, gap) => {
    found.push({ rule, a, b, gap: Math.round(gap * 10) / 10 });
  };
  const shapes = shapesOf(layout);
  for (const edge of shapes.edges) {
    labelOverlaps(edge, shapes, add);
    pathOverlaps(edge, shapes, add);
  }
  nodeOverlaps(shapes, add);
  for (const entry of shapes.entries) {
    for (const region of shapes.regions) {
      const gap = pathToBox(entry.line, region.titleBox);
      if (gap < PATH_NODE_CLEAR) add("path-through-node", entry.part, region.title, gap);
    }
    const inset = insetOfPoints(entry.line, shapes.canvas);
    if (!(inset >= 0)) add("outside", entry.part, "canvas", inset);
  }
  return found.sort(
    (x, y) => x.rule.localeCompare(y.rule) || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  );
}

/** One line per overlap, for a failing assertion's message. */
export function overlapLines(overlaps: ReadonlyArray<Overlap>): string[] {
  return overlaps.map((o) => `${o.rule}: ${o.a} / ${o.b} (${o.gap}px)`);
}
