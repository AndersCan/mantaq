import type { Graph, LLMContext } from "./types.ts";
import { reachable } from "./traverse.ts";
import type { AnyActor } from "@mantaq/core";

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/** Build LLM context from actor state and graph. */
export function llmContext(actor: AnyActor, graph: Graph): LLMContext {
  const currentState = actor.state.name;
  const node = graph.nodes.get(currentState);

  const possibleTransitions = graph.edges
    .filter((e) => e.from === currentState)
    .map((e) => ({
      eventId: e.eventId,
      targetState: e.to,
      isWildcard: e.isWildcard,
    }));

  const activeEffects = node?.effects ?? [];
  const isFinal = node?.isFinal ?? false;
  const stateInGraph = node !== undefined;

  const totalStates = graph.nodes.size;
  const totalEdges = graph.edges.length;
  const finalStates = Array.from(graph.nodes.values()).filter((n) => n.isFinal).length;
  const graphSummary = `State machine with ${totalStates} states, ${totalEdges} edges, ${finalStates} final states. Currently in "${currentState}". ${possibleTransitions.length} transition(s) available.`;

  return {
    currentState,
    possibleTransitions,
    activeEffects,
    isFinal,
    graphSummary,
    stateInGraph,
  };
}

/** Return OpenAI-style tool definitions for LLM function calling. */
export function llmToolDefinitions(): LLMToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "get_current_state",
        description: "Get the current state of the actor and whether it is final.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_possible_transitions",
        description:
          "Get all possible transitions from the current state, including event IDs and target states.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_graph_summary",
        description:
          "Get a human-readable summary of the entire state graph including state count, edge count, and current position.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_reachable",
        description: "Check if a target state is reachable from the current state via BFS.",
        parameters: {
          type: "object",
          properties: {
            targetState: {
              type: "string",
              description: "The state name to check reachability for.",
            },
          },
          required: ["targetState"],
        },
      },
    },
  ];
}

/** Handle LLM tool calls by routing to the appropriate function. */
export function llmToolHandler(
  toolName: string,
  args: Record<string, unknown>,
  actor: AnyActor,
  graph: Graph,
): unknown {
  const currentStateName = actor.state.name;

  switch (toolName) {
    case "get_current_state": {
      const node = graph.nodes.get(currentStateName);
      return {
        state: currentStateName,
        isFinal: node?.isFinal ?? false,
        effects: node?.effects ?? [],
      };
    }
    case "get_possible_transitions": {
      return graph.edges
        .filter((e) => e.from === currentStateName)
        .map((e) => ({
          eventId: e.eventId,
          targetState: e.to,
          isWildcard: e.isWildcard,
        }));
    }
    case "get_graph_summary": {
      const ctx = llmContext(actor, graph);
      return {
        summary: ctx.graphSummary,
        currentState: ctx.currentState,
        totalStates: graph.nodes.size,
        totalEdges: graph.edges.length,
      };
    }
    case "check_reachable": {
      if (typeof args.targetState !== "string") {
        return { error: "targetState parameter is required and must be a string" };
      }
      return { reachable: reachable(graph, currentStateName, args.targetState) };
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
