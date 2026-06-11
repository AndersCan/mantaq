import type { GraphNode, GraphEdge } from "../graph.ts";
import { nodeAttrs } from "./node-style.ts";
import { edgeConfig } from "./edge-style.ts";

const NODE_W = 160;
const NODE_H = 60;
const INITIAL_NODE_SIZE = 20;

export interface X6NodeDef {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  attrs: unknown;
}

export function toNodeDef(node: GraphNode, pos: { x: number; y: number }): X6NodeDef {
  return {
    id: node.id,
    shape: node.isInitial ? "circle" : "rect",
    x: pos.x,
    y: pos.y,
    width: node.isInitial ? INITIAL_NODE_SIZE : NODE_W,
    height: node.isInitial ? INITIAL_NODE_SIZE : NODE_H,
    label: node.isInitial ? "" : node.label,
    attrs: nodeAttrs(node),
  };
}

export function toEdgeDef(edge: GraphEdge, routerName: string = "normal") {
  return edgeConfig(edge, routerName);
}
