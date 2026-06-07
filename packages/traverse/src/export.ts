import type { Graph, GraphNode, ExportFormat } from "./types.ts";

/** Export a graph in the specified format. */
export function exportGraph(graph: Graph, format: ExportFormat): string {
  switch (format) {
    case "mermaid":
      return toMermaid(graph);
    case "dot":
      return toDot(graph);
    case "json":
      return toJson(graph);
  }
}

/** Convert graph to Mermaid stateDiagram-v2 syntax. */
export function toMermaid(graph: Graph): string {
  const lines: string[] = ["stateDiagram-v2"];
  const indent = "    ";

  for (const [id, node] of graph.nodes) {
    if (node.isInitial) {
      lines.push(`${indent}[*] --> ${id}`);
    }
    if (node.isFinal) {
      lines.push(`${indent}${id} --> [*]`);
    }
    if (node.regions && Object.keys(node.regions).length > 0) {
      lines.push(`${indent}state ${id} {`);
      for (const [regionName, regionGraph] of Object.entries(node.regions)) {
        lines.push(`${indent}    state ${regionName} {`);
        for (const [rId, rNode] of regionGraph.nodes) {
          if (rNode.isInitial) {
            lines.push(`${indent}        [*] --> ${rId}`);
          }
          if (rNode.isFinal) {
            lines.push(`${indent}        ${rId} --> [*]`);
          }
        }
        for (const edge of regionGraph.edges) {
          const label = ` : ${edge.eventId}`;
          lines.push(`${indent}        ${edge.from} --> ${edge.to}${label}`);
        }
        lines.push(`${indent}    }`);
      }
      lines.push(`${indent}}`);
    }
  }

  for (const edge of graph.edges) {
    const label = ` : ${edge.eventId}`;
    if (edge.isWildcard) {
      lines.push(`${indent}${edge.from} --> ${edge.to}${label}`);
      lines.push(`${indent}note right of ${edge.to}: wildcard transition`);
    } else {
      lines.push(`${indent}${edge.from} --> ${edge.to}${label}`);
    }
  }

  return lines.join("\n");
}

/** Convert graph to Graphviz DOT format. */
export function toDot(graph: Graph): string {
  const lines: string[] = ["digraph G {", "    rankdir=TB;"];

  for (const [id, node] of graph.nodes) {
    if (node.isInitial) {
      lines.push(`    __start [shape=point, label=""];`);
      lines.push(`    __start -> ${id};`);
    }
    const shape = node.isFinal ? "doublecircle" : "circle";
    lines.push(`    ${id} [shape=${shape}, label="${id}"];`);

    if (node.regions && Object.keys(node.regions).length > 0) {
      for (const [, regionGraph] of Object.entries(node.regions)) {
        for (const [rId, rNode] of regionGraph.nodes) {
          const rShape = rNode.isFinal ? "doublecircle" : "circle";
          lines.push(`    ${rId} [shape=${rShape}, label="${rId}"];`);
        }
        for (const edge of regionGraph.edges) {
          lines.push(`    ${edge.from} -> ${edge.to} [label="${edge.eventId}"];`);
        }
      }
    }
  }

  for (const edge of graph.edges) {
    const style = edge.isWildcard ? ", style=dashed" : "";
    lines.push(`    ${edge.from} -> ${edge.to} [label="${edge.eventId}"${style}];`);
  }

  lines.push("}");
  return lines.join("\n");
}

/** Convert graph to JSON format for custom visualizers. */
export function toJson(graph: Graph): string {
  const nodes = Array.from(graph.nodes.entries()).map(([, node]) => serializeNode(node));

  const data = {
    nodes,
    edges: graph.edges.map((e) => ({
      from: e.from,
      to: e.to,
      eventId: e.eventId,
      isWildcard: e.isWildcard,
    })),
    initial: graph.initial,
  };

  return JSON.stringify(data, null, 2);
}

function serializeNode(node: GraphNode): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: node.id,
    isInitial: node.isInitial,
    isFinal: node.isFinal,
    effects: node.effects,
  };

  if (node.regions && Object.keys(node.regions).length > 0) {
    const children: Record<string, unknown> = {};
    for (const [regionName, regionGraph] of Object.entries(node.regions)) {
      const regionNodes = Array.from(regionGraph.nodes.values()).map((n) => serializeNode(n));
      children[regionName] = {
        nodes: regionNodes,
        edges: regionGraph.edges.map((e) => ({
          from: e.from,
          to: e.to,
          eventId: e.eventId,
          isWildcard: e.isWildcard,
        })),
        initial: regionGraph.initial,
      };
    }
    result.children = children;
  }

  return result;
}
