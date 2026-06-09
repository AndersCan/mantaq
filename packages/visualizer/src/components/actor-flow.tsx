import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { ActorGraph } from "../graph.ts";
import { actorGraphToFlow } from "../react-flow-adapter.ts";
import { nodeTypes } from "./state-node.tsx";
import { edgeTypes } from "./edge.tsx";
import "./actor-flow.css";

interface ActorFlowProps {
  graph: ActorGraph;
  className?: string;
  style?: React.CSSProperties;
}

export function ActorFlow({ graph, className, style }: ActorFlowProps) {
  const initial = useMemo(() => actorGraphToFlow(graph), [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  useEffect(() => {
    const flow = actorGraphToFlow(graph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [graph, setNodes, setEdges]);

  return (
    <div className={`actor-flow${className ? ` ${className}` : ""}`} style={style}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
