import { html, render } from "lit-html";
import type { ActorGraph } from "../graph.ts";
import type { LayoutOptions } from "../layout.ts";
import type { Graph as X6Graph } from "@antv/x6";
import { createGraph } from "../x6/create-graph.ts";
import { syncGraph } from "../x6/sync.ts";

export interface ActorFlowInstance {
  graph: X6Graph;
  update: (graph: ActorGraph, layoutOptions?: LayoutOptions) => void;
  destroy: () => void;
}

export function renderActorFlow(
  parent: HTMLElement,
  options: {
    graph: ActorGraph;
    layoutOptions?: LayoutOptions;
    onEdgeClick?: (eventName: string, edgeId?: string) => void;
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
        .x6-graph-tooltip {
          position: absolute;
          background: #1e293b;
          color: #e2e8f0;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          font-family: monospace;
          pointer-events: none;
          z-index: 100;
          white-space: pre-line;
          display: none;
        }
      </style>
      <div class="actor-flow" style="width:100%;height:100%;min-height:300px"></div>
    `,
    parent,
  );

  const container = parent.querySelector<HTMLDivElement>(".actor-flow")!;
  const g = createGraph({ container });
  const movedPositions = new Map<string, { x: number; y: number }>();

  const tooltipEl = document.createElement("div");
  tooltipEl.className = "x6-graph-tooltip";
  container.appendChild(tooltipEl);

  setupTooltip(g, container, tooltipEl);

  trackDraggedPositions(g, movedPositions);

  if (options.onEdgeClick) {
    onEdgeClick(g, options.onEdgeClick);
  }

  syncGraph(g, graph, layoutOptions, movedPositions);

  return {
    graph: g,
    update(newGraph: ActorGraph, lo?: LayoutOptions) {
      syncGraph(g, newGraph, lo, movedPositions);
    },
    destroy() {
      g.dispose();
      movedPositions.clear();
      tooltipEl.remove();
      render("", parent);
    },
  };
}

function setupTooltip(
  g: ReturnType<typeof createGraph>,
  container: HTMLDivElement,
  tooltipEl: HTMLDivElement,
) {
  g.on("node:mouseenter", ({ node }) => {
    const data = node.getData();
    const text = data?.tooltip;
    if (!text) return;
    showTooltip(container, tooltipEl, text);
  });

  g.on("node:mousemove", ({ e }) => {
    moveTooltip(container, tooltipEl, e.clientX, e.clientY);
  });

  g.on("node:mouseleave", () => {
    hideTooltip(tooltipEl);
  });

  g.on("edge:mouseenter", ({ edge }) => {
    const data = edge.getData();
    const text = data?.tooltip;
    if (!text) return;
    showTooltip(container, tooltipEl, text);
  });

  g.on("edge:mousemove", ({ e }) => {
    moveTooltip(container, tooltipEl, e.clientX, e.clientY);
  });

  g.on("edge:mouseleave", () => {
    hideTooltip(tooltipEl);
  });

  container.addEventListener("mouseleave", () => {
    hideTooltip(tooltipEl);
  });
}

function showTooltip(container: HTMLElement, el: HTMLDivElement, text: string) {
  el.textContent = text;
  el.style.display = "block";
}

function moveTooltip(container: HTMLElement, el: HTMLDivElement, clientX: number, clientY: number) {
  const rect = container.getBoundingClientRect();
  el.style.left = `${clientX - rect.left + 12}px`;
  el.style.top = `${clientY - rect.top + 12}px`;
}

function hideTooltip(el: HTMLDivElement) {
  el.style.display = "none";
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

function onEdgeClick(
  g: ReturnType<typeof createGraph>,
  handler: (eventName: string, edgeId?: string) => void,
) {
  g.on("edge:click", ({ edge }) => {
    const data = edge.getData();
    if (!data?.isActive) return;

    if (data.isEffect && data.timerMs !== undefined) {
      handler(`__EFFECT__${data.timerMs}`, edge.id);
      return;
    }

    if (typeof data.eventId === "string") {
      handler(data.eventId, edge.id);
    }
  });
}
