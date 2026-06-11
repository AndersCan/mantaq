import { html, render } from "lit-html";
import type { ActorGraph } from "../graph.ts";
import type { LayoutOptions } from "../layout.ts";
import { createGraph } from "../x6/create-graph.ts";
import { syncGraph } from "../x6/sync.ts";

export interface ActorFlowInstance {
  update: (graph: ActorGraph, layoutOptions?: LayoutOptions) => void;
  destroy: () => void;
}

export function renderActorFlow(
  parent: HTMLElement,
  options: {
    graph: ActorGraph;
    layoutOptions?: LayoutOptions;
    onEdgeClick?: (eventName: string) => void;
  },
): ActorFlowInstance {
  const { graph, layoutOptions } = options;

  render(
    html`
      <style>
        .x6-graph-svg {
          display: block;
          width: 100%;
          height: 100%;
        }
        @keyframes ant-march {
          to {
            stroke-dashoffset: -1000;
          }
        }
      </style>
      <div class="actor-flow" style="width:100%;height:100%;min-height:300px"></div>
    `,
    parent,
  );

  const container = parent.querySelector<HTMLDivElement>(".actor-flow")!;
  const g = createGraph({ container });
  const movedPositions = new Map<string, { x: number; y: number }>();

  trackDraggedPositions(g, movedPositions);

  if (options.onEdgeClick) {
    onEdgeClick(g, options.onEdgeClick);
  }

  syncGraph(g, graph, layoutOptions, movedPositions);

  return {
    update(newGraph: ActorGraph, lo?: LayoutOptions) {
      syncGraph(g, newGraph, lo, movedPositions);
    },
    destroy() {
      g.dispose();
      movedPositions.clear();
      render("", parent);
    },
  };
}

function trackDraggedPositions(
  g: ReturnType<typeof createGraph>,
  positions: Map<string, { x: number; y: number }>,
) {
  g.on("node:change:position", ({ node, options }) => {
    if (options?.ui) {
      const p = node.getPosition();
      positions.set(node.id, { x: p.x, y: p.y });
    }
  });
}

function onEdgeClick(g: ReturnType<typeof createGraph>, handler: (eventName: string) => void) {
  g.on("edge:click", ({ edge }) => {
    const data = edge.getData();
    if (!data?.isActive) return;

    if (data.isEffect && data.timerMs !== undefined) {
      handler(`__EFFECT__${data.timerMs}`);
      return;
    }

    if (typeof data.eventId === "string") {
      handler(data.eventId);
    }
  });
}
