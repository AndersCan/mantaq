import { Graph } from "@antv/x6";
import { nodeMarkup } from "./node-style.ts";

export interface X6GraphOptions {
  container: HTMLElement;
  panning?: boolean;
  mousewheel?: boolean;
  background?: string;
}

Graph.registerNode(
  "mantaq-state",
  {
    inherit: "rect",
    width: 160,
    height: 60,
    markup: nodeMarkup(),
    attrs: {
      body: { rx: 8, ry: 8, fill: "#ffffff", stroke: "#64748b", strokeWidth: 1 },
      label: { fontSize: 13, fill: "#0f172a" },
    },
  },
  true,
);

export function createGraph(opts: X6GraphOptions): Graph {
  return new Graph({
    container: opts.container,
    panning: opts.panning ?? true,
    mousewheel: false,
    background: { color: opts.background ?? "#f8fafc" },
    grid: false,
  });
}
