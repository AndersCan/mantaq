import type { VizMachine } from "@mantaq/viz";
import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel, Point } from "@dagrejs/dagre";

export interface OverviewMachine {
  id: string;
  /** Absolute path of the file the machine comes from. */
  file: string;
}

export interface OverviewLink {
  from: string;
  to: string;
  /** Sorted. */
  events: string[];
}

interface PlacedBox {
  id: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacedLink {
  from: string;
  to: string;
  label: string;
  points: Array<{ x: number; y: number }>;
  labelAt: { x: number; y: number };
}

export interface Overview {
  width: number;
  height: number;
  boxes: PlacedBox[];
  links: PlacedLink[];
}

const BOX_HEIGHT = 40;
const CHAR_WIDTH = 8;
const LABEL_HEIGHT = 16;

/** A links B for each event A declares as an output and B handles as an input. */
export function machineLinks(
  machines: ReadonlyArray<{ file: string; machine: VizMachine }>,
): OverviewLink[] {
  const links: OverviewLink[] = [];
  for (const a of machines) {
    for (const b of machines) {
      if (a.machine.id === b.machine.id) continue;
      const inputs = new Set(
        b.machine.events
          .filter(
            (event) =>
              !event.internal &&
              b.machine.edges.some(
                (edge) =>
                  edge.event === event.id && (edge.kind === "transition" || edge.kind === "stay"),
              ),
          )
          .map((event) => event.id),
      );
      const events = a.machine.outputs.filter((id) => inputs.has(id)).toSorted();
      if (events.length > 0) links.push({ from: a.machine.id, to: b.machine.id, events });
    }
  }
  return links.toSorted((x, y) =>
    x.from === y.from ? (x.to < y.to ? -1 : x.to > y.to ? 1 : 0) : x.from < y.from ? -1 : 1,
  );
}

export function layoutOverview(
  machines: ReadonlyArray<OverviewMachine>,
  links: ReadonlyArray<OverviewLink>,
): Overview {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
  graph.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 72, marginx: 16, marginy: 16 });
  for (const machine of machines) {
    graph.setNode(machine.id, {
      width: 24 + CHAR_WIDTH * machine.id.length,
      height: BOX_HEIGHT,
    });
  }
  for (const link of links) {
    const label = link.events.join(", ");
    graph.setEdge(
      link.from,
      link.to,
      { width: CHAR_WIDTH * label.length, height: LABEL_HEIGHT, label },
      `${link.from}>${link.to}`,
    );
  }
  layout(graph);
  const size = graph.graph();
  return {
    width: size.width ?? 0,
    height: size.height ?? 0,
    boxes: machines.map((machine) => {
      const node = graph.node(machine.id);
      const width = node.width ?? 0;
      const height = node.height ?? 0;
      return {
        id: machine.id,
        file: machine.file,
        x: (node.x ?? 0) - width / 2,
        y: (node.y ?? 0) - height / 2,
        width,
        height,
      };
    }),
    links: links.map((link) => {
      const edge = graph.edge(link.from, link.to, `${link.from}>${link.to}`);
      return {
        from: link.from,
        to: link.to,
        label: link.events.join(", "),
        points: (edge.points ?? []).map((point: Point) => ({ x: point.x, y: point.y })),
        labelAt: { x: edge.x ?? 0, y: edge.y ?? 0 },
      };
    }),
  };
}
