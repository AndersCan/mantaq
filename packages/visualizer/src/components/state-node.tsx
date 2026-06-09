import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StateNode } from "../react-flow-adapter.ts";

function StateNodeComponent({ data, selected }: NodeProps<StateNode>) {
  const { label, isActive, isFinal } = data;

  return (
    <div
      className={`state-node${isActive ? " state-node--active" : ""}${selected ? " state-node--selected" : ""}${isFinal ? " state-node--final" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`State: ${label}${isActive ? ", active" : ""}${isFinal ? ", final" : ""}${selected ? ", selected" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <span className="state-node__label">{String(label ?? "")}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const MemoizedStateNode = memo(StateNodeComponent);

export default MemoizedStateNode;

export const nodeTypes = { state: MemoizedStateNode };
