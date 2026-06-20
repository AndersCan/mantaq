import { event } from "@mantaq/core";
import type { AnyActor, AnyEventRef } from "@mantaq/core";
import { buildGraph } from "../graph.ts";
import { highlightTransition } from "../x6/sync.ts";
import { renderActorFlow } from "../components/actor-flow.ts";
import type { ActorFlowInstance } from "../components/actor-flow.ts";
import type { ActorGraph } from "../graph.ts";
import type { LayoutOptions } from "../layout.ts";

export interface GraphSyncDeps {
  getActor(): AnyActor | null;
  getGraphEl(): HTMLDivElement | null;
  getLayoutOptions(): LayoutOptions;
  getSampleContexts(): Record<string, Record<string, unknown>> | null;
  getActiveContext(): string | null;
  getInternalIds(): Set<string>;
  onRerender(): void;
}

export class GraphSyncController {
  #flow: ActorFlowInstance | null = null;
  #deps: GraphSyncDeps;

  constructor(deps: GraphSyncDeps) {
    this.#deps = deps;
  }

  sync(): ActorGraph | null {
    const graphEl = this.#deps.getGraphEl();
    const actor = this.#deps.getActor();
    if (!graphEl || !actor) return null;
    const sampleContexts = this.#buildSampleContexts();
    const graph = buildGraph(actor, this.#deps.getInternalIds(), sampleContexts);
    if (this.#flow) {
      this.#flow.update(graph, this.#deps.getLayoutOptions());
    } else {
      this.#flow = renderActorFlow(graphEl, {
        graph,
        layoutOptions: this.#deps.getLayoutOptions(),
        onEdgeClick: (eventName: string, edgeId?: string) => this.#onEdgeClick(eventName, edgeId),
      });
    }
    return graph;
  }

  #buildSampleContexts(): Record<string, Record<string, unknown>> | undefined {
    const active = this.#deps.getActiveContext();
    const samples = this.#deps.getSampleContexts();
    if (!active || !samples) return undefined;
    return { [active]: samples[active] };
  }

  #onEdgeClick(eventName: string, edgeId?: string): void {
    if (eventName.startsWith("__EFFECT__")) {
      const timerMs = Number(eventName.replace("__EFFECT__", ""));
      const clock = this.#deps.getActor()?.clock as { advance?: (ms: number) => void };
      if (typeof clock.advance === "function") clock.advance(timerMs);
      if (edgeId) highlightTransition(this.#flow!.graph, edgeId);
      this.#deps.onRerender();
      return;
    }
    this.#deps.getActor()?.send(event(eventName)() as AnyEventRef);
    if (edgeId) highlightTransition(this.#flow!.graph, edgeId);
    this.#deps.onRerender();
  }

  get graph() {
    return this.#flow?.graph;
  }

  destroy(): void {
    this.#flow?.destroy();
    this.#flow = null;
  }
}
