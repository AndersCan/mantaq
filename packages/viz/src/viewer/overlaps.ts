import type { Point } from "@dagrejs/dagre";
import { scopeOf } from "../schema.ts";
import { ARROW_SIZE, FINAL_INSET, LABEL_PAD, PATH_GAP } from "./geometry.ts";
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
  | "paths-near"
  | "arrowheads"
  | "nodes"
  | "node-inside"
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

const PATH_NODE_CLEAR = 4;
const STUB = 12;
const SAMPLE_STEP = 2;
const MARK_OVERHANG = 6;
const ENTRY_DOT = 12;

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

const sampledPaths = new WeakMap<ReadonlyArray<Point>, Point[]>();

/** `samplePolyline`, remembered per route: label repair re-checks the same routes for every candidate spot. */
function sampledPath(points: ReadonlyArray<Point>): Point[] {
  const known = sampledPaths.get(points);
  if (known !== undefined) return known;
  const sampled = samplePolyline(points);
  sampledPaths.set(points, sampled);
  return sampled;
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

const pathBounds = new WeakMap<ReadonlyArray<Point>, Box>();

/** The smallest box around a route, remembered per route. */
function boundsOfPath(path: ReadonlyArray<Point>): Box {
  const known = pathBounds.get(path);
  if (known !== undefined) return known;
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const bounds = {
    x: (left + Math.max(...xs)) / 2,
    y: (top + Math.max(...ys)) / 2,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
  pathBounds.set(path, bounds);
  return bounds;
}

function pathToBox(path: ReadonlyArray<Point>, box: Box): number {
  const around = boxToBox(boundsOfPath(path), box);
  if (around >= LABEL_PAD) return around;
  let best = Infinity;
  for (const point of path) best = Math.min(best, pointToBox(point, box));
  return best;
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
  nodes: Array<{
    id: string;
    part: Part;
    box: Box;
    owner: string | null;
    frame: Box;
    /** A final state's inner frame: the name and chips keep `LABEL_PAD` inside it. */
    inner: Box | null;
    inside: Box[];
  }>;
  edges: Array<{
    id: string;
    from: string;
    target: string;
    path: Point[];
    route: ReadonlyArray<Point>;
    label: Box | null;
    arrow: Box;
  }>;
  entries: Array<{ part: Part; line: Point[]; route: Point[]; dot: Box }>;
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

/** The region a node sits in, as `ownersOf` in layout.ts decides it: a state's own, a `*`'s scope, an unknown's source. */
function ownerOf(layout: MachineLayout, node: MachineLayout["nodes"][number]): string | null {
  if (node.kind === "state") return node.state.region;
  if (node.kind === "any") return scopeOf(node.id) || null;
  const source = layout.edges.find((placed) => placed.target === node.id)?.edge.from;
  const from = layout.nodes.find((each) => each.id === source);
  return from === undefined || from.kind === "unknown" ? null : ownerOf(layout, from);
}

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
      owner: ownerOf(layout, node),
      frame: { x: node.x, y: node.y, width: node.width, height: node.height },
      inner:
        node.kind === "state" && node.state.final
          ? {
              x: node.x,
              y: node.y,
              width: node.width - 2 * FINAL_INSET,
              height: node.height - 2 * FINAL_INSET,
            }
          : null,
      inside:
        node.kind === "state"
          ? [node.label, ...node.chips, ...(node.workers ? [node.workers] : [])]
          : [],
    })),
    edges: [
      ...layout.edges.map((placed) => {
        const path = sampledPath(placed.points);
        return {
          id: placed.edge.id,
          from: placed.edge.from,
          target: placed.target,
          path,
          route: placed.points,
          label: placed.label,
          arrow: arrowBox(path),
        };
      }),
      ...layout.messages.map((placed) => {
        const path = sampledPath(placed.points);
        return {
          id: `message:${placed.from}>${placed.to}`,
          from: placed.from,
          target: placed.to,
          path,
          route: placed.points,
          label: null,
          arrow: arrowBox(path),
        };
      }),
    ],
    entries: layout.entries.map((entry, index) => ({
      part: `entry:${index}`,
      line: samplePolyline([entry.from, entry.to]),
      route: [entry.from, entry.to],
      dot: { x: entry.from.x, y: entry.from.y, width: ENTRY_DOT, height: ENTRY_DOT },
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
  const { label } = one;
  if (label === null) return;
  const part: Part = `label:${one.id}`;
  const near = (other: Part, gap: number): void => {
    if (gap < LABEL_PAD) add("label-clear", part, other, gap);
  };
  for (const other of rest.edges) {
    if (other.id > one.id && other.label !== null)
      near(`label:${other.id}`, boxToBox(label, other.label));
    near(`path:${other.id}`, pathToBox(other.path, label));
    near(`arrow:${other.id}`, boxToBox(label, other.arrow));
  }
  for (const node of rest.nodes) near(node.part, boxToBox(label, node.box));
  for (const entry of rest.entries) near(entry.part, pathToBox(entry.line, label));
  for (const region of rest.regions) {
    near(region.part, pathToBox(region.border, label));
    near(region.title, boxToBox(label, region.titleBox));
  }
  const inset = insetIn(label, rest.canvas);
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
}

/** Shortest distance between two segments that do not cross. */
function segmentGap(a1: Point, a2: Point, b1: Point, b2: Point): number {
  return Math.min(
    pointToSegment(a1, b1, b2),
    pointToSegment(a2, b1, b2),
    pointToSegment(b1, a1, a2),
    pointToSegment(b2, a1, a2),
  );
}

function pointToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Two routes' closest approach. A single crossing in the middle of both
 * segments is allowed when it is `PATH_GAP` from all four segment ends;
 * anything else must keep `PATH_GAP` between the segments.
 */
function routesGap(a: ReadonlyArray<Point>, b: ReadonlyArray<Point>): number {
  let best = Infinity;
  for (let i = 1; i < a.length; i++) {
    const a1 = a[i - 1];
    const a2 = a[i];
    if (a1 === undefined || a2 === undefined) continue;
    for (let j = 1; j < b.length; j++) {
      const b1 = b[j - 1];
      const b2 = b[j];
      if (b1 === undefined || b2 === undefined) continue;
      const near = crossingGap(a1, a2, b1, b2) ?? segmentGap(a1, a2, b1, b2);
      best = Math.min(best, near);
    }
  }
  return best;
}

/** For two segments that cross at one point: the distance from it to the nearest segment end; else undefined. */
function crossingGap(a1: Point, a2: Point, b1: Point, b2: Point): number | undefined {
  if (!segmentsCross(a1, a2, b1, b2)) return undefined;
  const t = cross(b1, b2, a1) / (cross(b1, b2, a1) - cross(b1, b2, a2));
  const at = { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
  const ends = Math.min(
    Math.hypot(at.x - a1.x, at.y - a1.y),
    Math.hypot(at.x - a2.x, at.y - a2.y),
    Math.hypot(at.x - b1.x, at.y - b1.y),
    Math.hypot(at.x - b2.x, at.y - b2.y),
  );
  return ends;
}

/** Every arrowhead and entry dot, at least `LABEL_PAD` from every other head and from every route that is not its own. */
function headOverlaps(shapes: Shapes, add: Add): void {
  const heads: Array<{ part: Part; box: Box; own: ReadonlyArray<Point> }> = [
    ...shapes.edges.map((edge) => ({
      part: `arrow:${edge.id}` as Part,
      box: edge.arrow,
      own: edge.route,
    })),
    ...shapes.entries.flatMap((entry) => [
      { part: entry.part, box: arrowBox(entry.route), own: entry.route },
      { part: entry.part, box: entry.dot, own: entry.route },
    ]),
  ];
  const routes: Array<{ part: Part; route: ReadonlyArray<Point>; sampled: Point[] }> = [
    ...shapes.edges.map((edge) => ({
      part: `path:${edge.id}` as Part,
      route: edge.route,
      sampled: edge.path,
    })),
    ...shapes.entries.map((entry) => ({
      part: entry.part,
      route: entry.route,
      sampled: entry.line,
    })),
  ];
  for (const [index, head] of heads.entries()) {
    for (const other of heads.slice(index + 1)) {
      if (other.own === head.own) continue;
      const gap = boxToBox(head.box, other.box);
      if (gap < LABEL_PAD) add("arrowheads", head.part, other.part, gap);
    }
    for (const other of routes) {
      if (other.route === head.own) continue;
      const gap = pathToBox(other.sampled, head.box);
      if (gap < LABEL_PAD) add("arrowheads", head.part, other.part, gap);
    }
  }
}

function routeOverlaps(shapes: Shapes, add: Add): void {
  const routes: Array<{ part: Part; route: ReadonlyArray<Point> }> = [
    ...shapes.edges.map((edge) => ({ part: `path:${edge.id}` as Part, route: edge.route })),
    ...shapes.entries.map((entry) => ({ part: entry.part, route: entry.route })),
  ];
  for (const [index, one] of routes.entries()) {
    for (const other of routes.slice(index + 1)) {
      if (boxToBox(boundsOfPath(one.route), boundsOfPath(other.route)) >= PATH_GAP) continue;
      const gap = routesGap(one.route, other.route);
      if (gap < PATH_GAP) add("paths-near", one.part, other.part, gap);
    }
  }
}

/** A state's name and chips sit `LABEL_PAD` inside its box (not the grown one) and apart. */
function insideOverlaps(node: Shapes["nodes"][number], add: Add): void {
  for (const [index, box] of node.inside.entries()) {
    const inset = insetIn(box, node.frame);
    if (inset < LABEL_PAD) add("node-inside", node.part, node.part, inset);
    const innerInset = node.inner === null ? Infinity : insetIn(box, node.inner);
    if (innerInset < LABEL_PAD) add("node-inside", node.part, node.part, innerInset);
    for (const other of node.inside.slice(index + 1)) {
      const gap = boxToBox(box, other);
      if (gap < LABEL_PAD) add("node-inside", node.part, node.part, gap);
    }
  }
}

function nodeOverlaps(shapes: Shapes, add: Add): void {
  for (const [index, node] of shapes.nodes.entries()) {
    for (const other of shapes.nodes.slice(index + 1)) {
      const gap = boxToBox(node.box, other.box);
      if (gap < LABEL_PAD) add("nodes", node.part, other.part, gap);
    }
    insideOverlaps(node, add);
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
  headOverlaps(shapes, add);
  routeOverlaps(shapes, add);
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
