/**
 * MantaqStateNode — the custom React Flow node. Renders the state chip:
 * label + effect badges. State is exposed via `data-*` attributes on the
 * node element so structural tests can assert without inspecting styles.
 *
 * Contract (specs/state-graph.md):
 * - no dragging (handled by the node: `draggable: false`),
 * - every state renders: default, active, selected, final, initial, error,
 * - effect edges are not drawn — badges carry the count instead,
 * - keyboard contract: the node itself is focusable via the wrapper.
 */

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import type { MantaqFlowNode } from "../../model/flow-adapter.ts";

export function MantaqStateNode({ data }: NodeProps<MantaqFlowNode>): ReactNode {
  if (data === undefined) return null; // malformed node data — nothing to render
  const { node, error } = data;
  return (
    <div
      className="mtq-node"
      data-node-id={node.id}
      data-active={node.isActive ? "true" : undefined}
      data-final={node.isFinal ? "true" : undefined}
      data-initial={node.isInitial ? "true" : undefined}
      data-error={error ? "true" : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <span className="mtq-node__label">{node.label}</span>
      {node.effects.length > 0 ? (
        <span className="mtq-node__effects">
          {node.effects.map((effect) => (
            <span
              key={effect.label}
              className="mtq-node__effect-badge"
              title={`${effect.count} effect fn(s)`}
            >
              {effect.label}
            </span>
          ))}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
