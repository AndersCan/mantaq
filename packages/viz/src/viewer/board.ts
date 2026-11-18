import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel, Point } from "@dagrejs/dagre";
import type { VizMachine } from "../schema.ts";
import { dotGapFor, messagesOf, pathLength, textWidth } from "./layout.ts";
import { partName, partOf, partsOf } from "./parts.ts";

const PART_HEIGHT = 28;
const PART_PAD = 12;
const PART_GAP = 12;
const BOARD_MARGIN = 12;
const RANK_GAP = 48;

/** A part's box; x and y are its centre. */
export interface PlacedPart {
  part: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacedWire {
  from: string;
  to: string;
  both: boolean;
  path: string;
  points: Point[];
  dotGap: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  parts: PlacedPart[];
  wires: PlacedWire[];
}

interface Pair {
  from: string;
  to: string;
  both: boolean;
}

function pairsOf(machine: VizMachine): Pair[] {
  const pairs: Pair[] = [];
  for (const message of messagesOf(machine)) {
    const from = partOf(machine, message.from);
    const to = partOf(machine, message.to);
    if (from === to) continue;
    const found = pairs.find(
      (pair) => (pair.from === from && pair.to === to) || (pair.from === to && pair.to === from),
    );
    if (found === undefined) pairs.push({ from, to, both: false });
    else if (found.from === to) found.both = true;
  }
  return pairs;
}

function polyline(points: ReadonlyArray<Point>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

interface Block {
  placed: PlacedPart[];
  wires: PlacedWire[];
  width: number;
  height: number;
}

/** The parts that message each other, placed by their wires. */
function wiredBlock(pairs: Pair[], names: ReadonlyMap<string, string>): Block {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: false });
  graph.setGraph({
    rankdir: "LR",
    nodesep: PART_GAP,
    ranksep: RANK_GAP,
    marginx: BOARD_MARGIN,
    marginy: BOARD_MARGIN,
  });
  for (const part of new Set(pairs.flatMap((pair) => [pair.from, pair.to]))) {
    graph.setNode(part, { width: boxWidth(names.get(part) ?? ""), height: PART_HEIGHT });
  }
  for (const pair of pairs) graph.setEdge(pair.from, pair.to, { width: 0, height: 0 });
  layout(graph);
  return {
    placed: graph.nodes().map((part: string) => {
      const node = graph.node(part);
      return { part, name: names.get(part) ?? "", ...node };
    }),
    wires: pairs.map((pair) => {
      const points = graph.edge(pair.from, pair.to).points;
      return { ...pair, path: polyline(points), points, dotGap: dotGapFor(pathLength(points)) };
    }),
    width: graph.graph().width ?? 0,
    height: graph.graph().height ?? 0,
  };
}

function boxWidth(name: string): number {
  return Math.ceil(textWidth(name) + 2 * PART_PAD);
}

/** One box per part: parts that message each other placed by their wires, the rest in rows that fill `width`. */
export function placeBoard(machine: VizMachine, width: number): BoardLayout {
  const names = new Map(partsOf(machine).map((part) => [part, partName(machine, part)]));
  const pairs = pairsOf(machine);
  const block: Block =
    pairs.length > 0 ? wiredBlock(pairs, names) : { placed: [], wires: [], width: 0, height: 0 };
  const placed = new Map(block.placed.map((box) => [box.part, box]));
  const limit = Math.max(width, block.width) - BOARD_MARGIN;
  let top = pairs.length > 0 ? block.height + PART_GAP : BOARD_MARGIN;
  let left = BOARD_MARGIN;
  let right = block.width;
  for (const [part, name] of names) {
    if (placed.has(part)) continue;
    const size = boxWidth(name);
    if (left > BOARD_MARGIN && left + size > limit) {
      left = BOARD_MARGIN;
      top += PART_HEIGHT + PART_GAP;
    }
    placed.set(part, {
      part,
      name,
      x: left + size / 2,
      y: top + PART_HEIGHT / 2,
      width: size,
      height: PART_HEIGHT,
    });
    left += size + PART_GAP;
    right = Math.max(right, left - PART_GAP + BOARD_MARGIN);
  }
  const parts = [...names.keys()].flatMap((part) => placed.get(part) ?? []);
  const bottom = Math.max(
    block.height,
    ...parts.map((box) => box.y + box.height / 2 + BOARD_MARGIN),
  );
  return { width: right, height: bottom, parts, wires: block.wires };
}
