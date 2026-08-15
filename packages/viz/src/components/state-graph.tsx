/**
 * StateGraph — the graph alone (specs/state-graph.md).
 *
 * Renders the actor's machine as a React Flow canvas:
 * - finite states: ready (canvas), empty (missing actor / zero nodes),
 *   error (banner + 30% canvas when a last-good graph exists, banner alone
 *   otherwise), dimmed-while-scrubbed (Phase 2: scrubIndex prop accepted,
 *   no-op today),
 * - fitView on mount only — never per-update,
 * - no inline style; every color/spacing/radius from tokens,
 * - every node carries `data-node-id`, structural attrs on the canvas root.
 */

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";
import type { AnyActor } from "@mantaq/core";
import { VizProvider } from "../model/viz-provider.tsx";
import { useActorModel } from "../model/use-actor-model.ts";
import { FLOW_EDGE_TYPE, FLOW_NODE_TYPE, toFlowEdges, toFlowNodes } from "../model/flow-adapter.ts";
import { MantaqEdge } from "./nodes/mantaq-edge.tsx";
import { MantaqStateNode } from "./nodes/mantaq-state.tsx";
import { ErrorBanner } from "./error-banner.tsx";

export interface StateGraphProps {
  actor: AnyActor;
  /** Interactive canvas (pan/zoom/select). Default true. */
  interactive?: boolean;
  /** Controlled selection: id of the selected node. */
  selectedId?: string;
  /** Called with the selected node id (undefined on deselection). */
  onSelect?: (id: string | undefined) => void;
  /** Scrub index (Phase 2). When set, the canvas renders dimmed. */
  scrubIndex?: number;
}

function StateGraphCanvas(props: StateGraphProps): ReactNode {
  const { interactive = true, selectedId, onSelect, scrubIndex } = props;
  const model = useActorModel();

  const nodes = useMemo(
    () =>
      toFlowNodes(model.graph, model.layout).map((node) =>
        selectedId !== undefined ? { ...node, selected: node.id === selectedId } : node,
      ),
    [model.graph, model.layout, selectedId],
  );
  const edges = useMemo(() => toFlowEdges(model.graph), [model.graph]);
  const nodeTypes = useMemo(() => ({ [FLOW_NODE_TYPE]: MantaqStateNode }), []);
  const edgeTypes = useMemo(() => ({ [FLOW_EDGE_TYPE]: MantaqEdge }), []);

  const onSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: { id: string }[] }) => {
      onSelect?.(selected[0]?.id);
    },
    [onSelect],
  );

  const interactiveProps = interactive
    ? {}
    : {
        panOnDrag: false,
        zoomOnScroll: false,
        zoomOnPinch: false,
        elementsSelectable: false,
      };

  return (
    <div
      className="mtq-state-graph"
      data-node-count={model.graph.nodes.length}
      data-edge-count={model.graph.edges.length}
      data-error={model.error !== undefined ? "true" : undefined}
      data-scrubbed={scrubIndex !== undefined ? "true" : undefined}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onSelectionChange={onSelectionChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        nodesConnectable={false}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
        {...interactiveProps}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {model.error !== undefined ? <ErrorBanner error={model.error} /> : null}
    </div>
  );
}

export function StateGraph(props: StateGraphProps): ReactNode {
  return (
    <VizProvider actor={props.actor}>
      <StateGraphCanvas {...props} />
    </VizProvider>
  );
}
