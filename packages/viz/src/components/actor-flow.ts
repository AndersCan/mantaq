import { html, render } from "lit-html";
import { Graph } from "@antv/x6";
import type { ActorGraph } from "../graph.ts";
import { computeNodePositions } from "../layout.ts";
import type { LayoutOptions } from "../layout.ts";

const NODE_W = 160;
const NODE_H = 60;
const INITIAL_NODE_SIZE = 20;

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

  const el = parent.querySelector<HTMLDivElement>(".actor-flow")!;
  const g = new Graph({
    container: el,
    panning: true,
    mousewheel: true,
    background: { color: "#f8fafc" },
    grid: false,
  });

  const movedPositions = new Map<string, { x: number; y: number }>();

  g.on("node:change:position", ({ node, options }) => {
    if (options?.ui) {
      const p = node.getPosition();
      movedPositions.set(node.id, { x: p.x, y: p.y });
    }
  });

  const onClick = options.onEdgeClick;
  if (onClick) {
    g.on("edge:click", ({ edge }) => {
      const isActive = edge.getData()?.isActive;
      if (!isActive) return;
      const isEffect = edge.getData()?.isEffect;
      const timerMs = edge.getData()?.timerMs;
      if (isEffect && timerMs !== undefined) {
        onClick(`__EFFECT__${timerMs}`);
        return;
      }
      const eventId = edge.getData()?.eventId;
      if (typeof eventId === "string") onClick(eventId);
    });
  }

  function nodeAttrs(n: ActorGraph["nodes"][number]) {
    if (n.isInitial) {
      return {
        body: {
          fill: "#1e293b",
          stroke: "none",
        },
      };
    }
    return {
      body: {
        stroke: n.isFinal ? "#059669" : n.isActive ? "#3b82f6" : "#64748b",
        strokeWidth: n.isFinal ? 2.5 : n.isActive ? 2 : 1,
        fill: n.isActive ? "#eff6ff" : "#ffffff",
        rx: 8,
        ry: 8,
      },
    };
  }

  function edgeConfig(e: ActorGraph["edges"][number], routerName: string = "normal") {
    const isEffect = e.isActive && e.isInternal;
    const labelText = isEffect ? (e.effectLabel ?? "Effect") : e.label;

    return {
      id: e.id,
      shape: "edge",
      source: e.source,
      target: e.target,
      z: 2,
      router: { name: routerName },
      connector: { name: "smooth" },
      data: { isActive: e.isActive, eventId: e.label, isEffect, timerMs: e.timerMs },
      labels: [
        {
          position: { distance: 0.4 },
          attrs: {
            label: {
              text: labelText,
              fontSize: 12,
              fill: isEffect ? "#d97706" : e.isActive ? "#0f172a" : "#94a3b8",
              fontWeight: "600",
              cursor: "pointer",
            },
            body: {
              fill: isEffect ? "#fffbeb" : e.isActive ? "#e2e8f0" : "#f1f5f9",
              stroke: isEffect ? "#fbbf24" : e.isActive ? "#94a3b8" : "#cbd5e1",
              strokeWidth: 1,
              rx: 4,
              ry: 4,
              refWidth: "160%",
              refHeight: "160%",
              refX: "-30%",
              refY: "-30%",
              cursor: "pointer",
            },
          },
        },
      ],
      attrs: {
        line: {
          stroke: isEffect ? "#d97706" : e.isActive ? "#3b82f6" : "#94a3b8",
          strokeWidth: isEffect ? 1.5 : e.isActive ? 2 : 1,
          strokeDasharray: isEffect ? 5 : e.isActive ? undefined : "5 3",
          targetMarker: { name: "classic", size: 8 },
          cursor: "pointer",
          ...(isEffect ? { style: { animation: "ant-march 60s infinite linear" } } : {}),
        },
      },
    };
  }

  function sync(graph: ActorGraph, lo?: LayoutOptions) {
    const computed = computeNodePositions(graph.nodes, graph.edges, lo);
    const newNodeIds = new Set(graph.nodes.map((n) => n.id));
    const newEdgeIds = new Set(graph.edges.map((e) => e.id));
    const routerName = lo?.router ?? "normal";
    let structureChanged = false;

    for (const n of graph.nodes) {
      const cell = g.getCellById(n.id);
      if (cell && cell.isNode()) {
        const pos = movedPositions.get(n.id) ?? {
          x: cell.getPosition().x,
          y: cell.getPosition().y,
        };
        cell.setPosition(pos.x, pos.y);
        cell.setAttrs(nodeAttrs(n));
        cell.attr("text/text", n.label);
      } else {
        const pos = movedPositions.get(n.id) ?? computed.get(n.id) ?? { x: 0, y: 0 };
        g.addNode({
          id: n.id,
          shape: n.isInitial ? "circle" : "rect",
          x: pos.x,
          y: pos.y,
          width: n.isInitial ? INITIAL_NODE_SIZE : NODE_W,
          height: n.isInitial ? INITIAL_NODE_SIZE : NODE_H,
          label: n.isInitial ? "" : n.label,
          attrs: nodeAttrs(n),
        });
        structureChanged = true;
      }
    }

    for (const cell of g.getNodes()) {
      if (!newNodeIds.has(cell.id)) {
        g.removeCell(cell.id);
        structureChanged = true;
      }
    }

    for (const e of graph.edges) {
      const cell = g.getCellById(e.id);
      if (cell && cell.isEdge()) {
        const ecfg = edgeConfig(e, routerName);
        cell.setRouter({ name: routerName });
        if (cell.getSourceCellId() !== e.source) cell.setSource({ cell: e.source });
        if (cell.getTargetCellId() !== e.target) cell.setTarget({ cell: e.target });
        cell.setData(ecfg.data);
        cell.setLabels(ecfg.labels);
        // Only update individual line attrs to prevent animation restart on existing edges
        const line = ecfg.attrs.line;
        cell.attr("line/stroke", line.stroke);
        cell.attr("line/strokeWidth", line.strokeWidth);
        cell.attr("line/strokeDasharray", line.strokeDasharray);
        cell.attr("line/targetMarker", line.targetMarker);
        cell.attr("line/cursor", line.cursor);
      } else {
        g.addEdge(edgeConfig(e, routerName));
        structureChanged = true;
      }
    }

    for (const cell of g.getEdges()) {
      if (!newEdgeIds.has(cell.id)) {
        g.removeCell(cell.id);
        structureChanged = true;
      }
    }

    if (structureChanged) {
      g.zoomToFit({ padding: 40, maxScale: 1 });
    }
  }

  sync(graph, layoutOptions);

  return {
    update(newGraph: ActorGraph, lo?: LayoutOptions) {
      sync(newGraph, lo);
    },
    destroy() {
      g.dispose();
      movedPositions.clear();
      render("", parent);
    },
  };
}
