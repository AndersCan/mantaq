import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StateNode } from "../react-flow-adapter.ts";

const NODE_WIDTH = 120;
const NODE_HEIGHT = 60;

export function StateNodeComponent({ data, selected }: NodeProps<StateNode>) {
  const { label, isActive, isFinal } = data;
  const fill = isActive ? "var(--viz-node-active-bg, #dcfce7)" : "var(--viz-node-bg, #ffffff)";
  const stroke = isActive
    ? "var(--viz-node-active-border, #22c55e)"
    : "var(--viz-node-border, #d1d5db)";
  const sw = isActive ? 2 : 1;
  const aria = `State: ${label}${isActive ? ", active" : ""}${isFinal ? ", final" : ""}${selected ? ", selected" : ""}`;

  return (
    <div className="state-node">
      <Handle type="target" position={Position.Top} />
      <svg width={NODE_WIDTH} height={NODE_HEIGHT} role="button" tabIndex={0} aria-label={aria}>
        <g className="node">
          {isActive && (
            <rect
              className="active-glow"
              x={-4}
              y={-4}
              width={NODE_WIDTH + 8}
              height={NODE_HEIGHT + 8}
            />
          )}
          {selected && (
            <rect
              className="selected-ring"
              x={-6}
              y={-6}
              width={NODE_WIDTH + 12}
              height={NODE_HEIGHT + 12}
            />
          )}
          <rect
            className="node-bg"
            x={0}
            y={0}
            width={NODE_WIDTH}
            height={NODE_HEIGHT}
            rx={6}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <text
            className="node-label"
            x={NODE_WIDTH / 2}
            y={NODE_HEIGHT / 2}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {String(label ?? "")}
          </text>
          {isFinal && (
            <rect
              className="final-indicator"
              x={4}
              y={4}
              width={NODE_WIDTH - 8}
              height={NODE_HEIGHT - 8}
            />
          )}
        </g>
      </svg>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = { state: StateNodeComponent };
