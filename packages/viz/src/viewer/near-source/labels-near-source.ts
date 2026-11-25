import type { LabelBox, MachineLayout, PlacedEdge } from "../layout.ts";
import { LABEL_PAD } from "../geometry.ts";
import type { LabelClashes } from "../overlaps.ts";
import { labelClashesOf } from "../overlaps.ts";

/** A point of an arrow's line. */
type Point = PlacedEdge["points"][number];

/** How far a label moves between two places it tries. */
const STEP = 4;

interface Segment {
  /** The end nearer the state the arrow leaves. */
  start: Point;
  end: Point;
}

interface LevelOptions {
  end: Point | undefined;
}

/** True when `start` and `options.end` are on one level line. */
function isLevel(start: Point, options: LevelOptions): boolean {
  return options.end !== undefined && Math.abs(start.y - options.end.y) < 0.5;
}

/** The level part of the arrow's line that its label hangs under, when there is one; points in a row on one level count as one part. */
function hungUnder(placed: PlacedEdge): Segment | undefined {
  const { label, points } = placed;
  const top = label.y - label.height / 2;
  let found: Segment | undefined;
  let first = 0;
  for (const [index, end] of points.entries()) {
    const start = points[index - 1];
    if (start === undefined) continue;
    if (!isLevel(start, { end: points[index - 2] })) first = index - 1;
    const level = isLevel(start, { end }) && start.y <= top;
    const over = Math.min(start.x, end.x) <= label.x && label.x <= Math.max(start.x, end.x);
    const nearer = found === undefined || start.y > found.start.y;
    const hangs = level && over;
    if (hangs && nearer) found = { start: points[first] ?? start, end };
  }
  return found;
}

interface ShiftOptions {
  /** Where the label's centre goes along x. */
  at: number;
}

/** The label and its text moved along x so the label's centre is at `options.at`. */
function shifted(placed: PlacedEdge, options: ShiftOptions): PlacedEdge {
  const move = options.at - placed.label.x;
  const label: LabelBox = { ...placed.label, x: options.at };
  return { ...placed, label, text: { ...placed.text, x: placed.text.x + move } };
}

/** The places the label tries along its segment, nearest the state the arrow leaves first, up to where it is. */
function tries(placed: PlacedEdge, segment: Segment): number[] {
  const way = Math.sign(segment.end.x - segment.start.x);
  const first = segment.start.x + way * (placed.label.width / 2 + LABEL_PAD);
  const places: number[] = [];
  for (let at = first; (placed.label.x - at) * way > 0; at += way * STEP) places.push(at);
  return places;
}

interface NearOptions {
  clashes: LabelClashes;
}

/** The arrow's label as near the state it leaves as it fits along the line it hangs under, with nothing nearer to it than before. */
function nearSource(placed: PlacedEdge, options: NearOptions): PlacedEdge {
  const segment = placed.target === placed.edge.from ? undefined : hungUnder(placed);
  const places = segment === undefined ? [] : tries(placed, segment);
  if (places.length === 0) return placed;
  const { count } = options.clashes;
  const edge = placed.edge.id;
  const now = count({ edge, label: placed.label });
  for (const at of places) {
    const moved = shifted(placed, { at });
    if (count({ edge, label: moved.label }) <= now) return moved;
  }
  return placed;
}

/**
 * Moves each arrow's label along its line toward the state it leaves, as far as
 * it goes without coming nearer to anything. A reader then finds the events a
 * state sends beside it, and a narrow canvas shows them with the state.
 */
export function labelsNearSource(layout: MachineLayout): MachineLayout {
  const clashes = labelClashesOf(layout);
  let { edges } = layout;
  for (const [index, placed] of layout.edges.entries()) {
    const moved = nearSource(placed, { clashes });
    if (moved === placed) continue;
    clashes.settle({ edge: placed.edge.id, label: moved.label });
    edges = edges.with(index, moved);
  }
  return { ...layout, edges };
}
