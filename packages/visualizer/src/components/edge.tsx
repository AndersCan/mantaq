import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { StateEdge } from "../react-flow-adapter.ts";

function StateEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
  data,
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
  const guardText = data?.payload?.guard;
  const actionText = data?.payload?.action;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {labelText && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan edge-label"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            <span className="edge-label__text">{labelText}</span>
            {guardText && <span className="edge-label__guard">{guardText}</span>}
            {actionText && <span className="edge-label__action">{actionText}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const MemoizedStateEdge = memo(StateEdgeComponent);

export default MemoizedStateEdge;

export const edgeTypes = { "state-edge": MemoizedStateEdge };
