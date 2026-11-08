import type { VizMachine, VizOutputRoutes } from "@mantaq/viz";
import type { NotRun, Unheard, Wire } from "../ast/wires.ts";
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
  /** App-code connections from `from` to `to`, in the order given. */
  wires: Wire[];
}

interface PlacedBox {
  id: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** False when no app code uses the machine's factory. */
  runs: boolean;
}

interface PlacedLink {
  from: string;
  to: string;
  label: string;
  points: Array<{ x: number; y: number }>;
  labelAt: { x: number; y: number };
}

interface PlacedUnheard {
  from: string;
  outputs: string[];
  label: string;
  points: Array<{ x: number; y: number }>;
  labelAt: { x: number; y: number };
}

export interface Overview {
  width: number;
  height: number;
  boxes: PlacedBox[];
  links: PlacedLink[];
  /** Every link's wires, in link order. */
  wires: Wire[];
  /** Machines no app code runs, in the order given. */
  notRun: NotRun[];
  /** Outputs no app code listens to, one arrow per machine. */
  unheard: PlacedUnheard[];
}

const BOX_HEIGHT = 40;
const CHAR_WIDTH = 8;
const LABEL_HEIGHT = 16;

function labelOf(link: OverviewLink): string {
  const wires = link.wires.map((wire) => `${wire.trigger} → ${wire.event}`);
  return [...new Set([...link.events, ...wires])].join(", ");
}

/**
 * Per machine, per output id: the app-code wires that take it, in wire order.
 * An unguarded wire ("output") takes every output; "change" wires are never routes.
 */
export function outputRoutes(
  machines: ReadonlyArray<VizMachine>,
  wires: ReadonlyArray<Wire>,
): VizOutputRoutes {
  const result: VizOutputRoutes = {};
  for (const machine of machines) {
    const byOutput: Record<string, Array<{ to: string; event: string; at: string }>> = {};
    for (const id of machine.outputs) {
      const routes = wires
        .filter(
          (wire) => wire.from === machine.id && (wire.trigger === id || wire.trigger === "output"),
        )
        .map(({ to, event, at }) => ({ to, event, at }));
      if (routes.length > 0) byOutput[id] = routes;
    }
    if (Object.keys(byOutput).length > 0) result[machine.id] = byOutput;
  }
  return result;
}

/**
 * A links B for each event A declares as an output and B handles as an input,
 * and for each wire from A to B. Wires naming a machine not given are ignored.
 */
export function machineLinks(
  machines: ReadonlyArray<{ file: string; machine: VizMachine }>,
  wires: ReadonlyArray<Wire> = [],
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
      const own = wires.filter((wire) => wire.from === a.machine.id && wire.to === b.machine.id);
      if (events.length > 0 || own.length > 0) {
        links.push({ from: a.machine.id, to: b.machine.id, events, wires: own });
      }
    }
  }
  return links.toSorted((x, y) =>
    x.from === y.from ? (x.to < y.to ? -1 : x.to > y.to ? 1 : 0) : x.from < y.from ? -1 : 1,
  );
}

export function layoutOverview(
  machines: ReadonlyArray<OverviewMachine>,
  links: ReadonlyArray<OverviewLink>,
  notRun: ReadonlyArray<NotRun> = [],
  unheard: ReadonlyArray<Unheard> = [],
): Overview {
  const shown = unheard.filter((each) => machines.some((machine) => machine.id === each.id));
  const unheardLabel = (each: Unheard) => `${each.outputs.join(", ")} → nobody`;
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
  graph.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 72, marginx: 16, marginy: 16 });
  for (const machine of machines) {
    graph.setNode(machine.id, {
      width: 24 + CHAR_WIDTH * machine.id.length,
      height: BOX_HEIGHT,
    });
  }
  for (const link of links) {
    const label = labelOf(link);
    graph.setEdge(
      link.from,
      link.to,
      { width: CHAR_WIDTH * label.length, height: LABEL_HEIGHT, label },
      `${link.from}>${link.to}`,
    );
  }
  for (const each of shown) {
    const label = unheardLabel(each);
    graph.setNode(`nobody>${each.id}`, { width: 1, height: 1 });
    graph.setEdge(
      each.id,
      `nobody>${each.id}`,
      { width: CHAR_WIDTH * label.length, height: LABEL_HEIGHT, label },
      `${each.id}>nobody`,
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
        runs: !notRun.some((each) => each.id === machine.id),
      };
    }),
    links: links.map((link) => {
      const edge = graph.edge(link.from, link.to, `${link.from}>${link.to}`);
      return {
        from: link.from,
        to: link.to,
        label: labelOf(link),
        points: (edge.points ?? []).map((point: Point) => ({ x: point.x, y: point.y })),
        labelAt: { x: edge.x ?? 0, y: edge.y ?? 0 },
      };
    }),
    wires: links.flatMap((link) => link.wires),
    notRun: notRun.filter((each) => machines.some((machine) => machine.id === each.id)),
    unheard: shown.map((each) => {
      const edge = graph.edge(each.id, `nobody>${each.id}`, `${each.id}>nobody`);
      return {
        from: each.id,
        outputs: each.outputs,
        label: unheardLabel(each),
        points: (edge.points ?? []).map((point: Point) => ({ x: point.x, y: point.y })),
        labelAt: { x: edge.x ?? 0, y: edge.y ?? 0 },
      };
    }),
  };
}
