import { Graph } from "@antv/x6";

export interface X6GraphOptions {
  container: HTMLElement;
  panning?: boolean;
  mousewheel?: boolean;
  background?: string;
}

export function createGraph(opts: X6GraphOptions): Graph {
  return new Graph({
    container: opts.container,
    panning: opts.panning ?? true,
    mousewheel: false,
    background: { color: opts.background ?? "#f8fafc" },
    grid: false,
  });
}
