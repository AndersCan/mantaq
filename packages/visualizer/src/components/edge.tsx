import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { StateEdge } from "../react-flow-adapter.ts";

export function StateEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
}: EdgeProps<StateEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const labelText = typeof label === "string" ? label : undefined;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      label={labelText}
      labelX={labelX}
      labelY={labelY}
    />
  );
}

export const edgeTypes = { default: StateEdgeComponent };
