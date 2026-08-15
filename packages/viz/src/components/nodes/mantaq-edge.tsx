/**
 * MantaqEdge — custom React Flow edge. Bezier for normal edges, a fixed arc
 * for self-loops (degenerate bezier otherwise). State via `data-edge-state`:
 * `default` | `active` | `undetermined` | `initial`.
 *
 * Undetermined edges are dashed red self-loops ("no target resolved for
 * EVENT") — target collapses to source in the graph model, so the arc
 * renders the loop.
 */

import { BaseEdge, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import type { VizEdge } from "../../core/index.ts";
import type { MantaqFlowEdge } from "../../model/flow-adapter.ts";

type EdgeRenderState = "default" | "active" | "undetermined" | "initial";

function edgeRenderState(edge: VizEdge): EdgeRenderState {
  if (edge.kind === "undetermined") return "undetermined";
  if (edge.kind === "initial") return "initial";
  return edge.isActive ? "active" : "default";
}

/** Deterministic arc for self-loop edges (no degenerate bezier). */
function selfLoopPath(x: number, y: number): string {
  const rx = 28;
  const ry = 16;
  return [`M ${x} ${y}`, `C ${x - rx} ${y - ry}, ${x + rx} ${y - ry}, ${x} ${y}`].join(" ");
}

export function MantaqEdge(props: EdgeProps<MantaqFlowEdge>): ReactNode {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
  } = props;
  const edge = data?.edge;
  if (edge === undefined) return null; // malformed node data — nothing to render
  const isSelfLoop = edge.source === edge.target;
  const path = isSelfLoop
    ? selfLoopPath(sourceX, sourceY)
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0];
  const state = edgeRenderState(edge);

  return (
    <BaseEdge
      id={id}
      path={path}
      className={`mtq-edge mtq-edge--${state}`}
      data-edge-state={state}
      data-source={edge.source}
      data-target={edge.target}
      data-undetermined={edge.kind === "undetermined" ? edge.label : undefined}
      markerEnd={edge.kind === "undetermined" ? undefined : markerEnd}
    />
  );
}
