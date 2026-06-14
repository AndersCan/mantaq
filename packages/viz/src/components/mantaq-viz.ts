import { html, render } from "lit-html";
import { event } from "@mantaq/core";
import type { AnyActor, AnyEventRef } from "@mantaq/core";
import { buildGraph } from "../graph.ts";
import { highlightTransition } from "../x6/sync.ts";
import { renderActorFlow } from "./actor-flow.ts";
import type { ContextViewer } from "./context-viewer.ts";
import "./context-viewer.ts";
import { TransitionTimeline } from "./transition-timeline.ts";
import "./transition-timeline.ts";
import type { ActorGraph, GraphNode } from "../graph.ts";
import type { LayoutOptions } from "../layout.ts";

const RANKSEP_DEFAULT = 100;
const RANKSEP_MIN = 20;
const RANKSEP_MAX = 320;

interface EventCategory {
  name: string;
  events: string[];
  isInternal: boolean;
}

export class MantaqViz extends HTMLElement {
  #actor: AnyActor | null = null;
  #name: string = "Actor";
  #flow: ReturnType<typeof renderActorFlow> | null = null;
  #direction: "TB" | "LR" = "LR";
  #ranksep = RANKSEP_DEFAULT;
  #router: "normal" | "orth" | "manhattan" | "metro" | "er" = "normal";
  #settingsOpen = false;
  #sampleContexts: Record<string, Record<string, unknown>> | null = null;
  #activeContext: string | null = null;

  set actor(a: AnyActor | null) {
    this.#actor = a;
    if (this.isConnected) this.#renderAll();
  }

  get actor(): AnyActor | null {
    return this.#actor;
  }

  set name(n: string) {
    this.#name = n;
    if (this.isConnected) this.#renderAll();
  }

  get name(): string {
    return this.#name;
  }

  set sampleContexts(value: Record<string, Record<string, unknown>> | null) {
    this.#sampleContexts = value;
    this.#activeContext = value ? (Object.keys(value)[0] ?? null) : null;
    if (this.isConnected) this.#renderAll();
  }

  get sampleContexts(): Record<string, Record<string, unknown>> | null {
    return this.#sampleContexts;
  }

  set activeContext(name: string | null) {
    this.#activeContext = name;
    if (this.isConnected) this.#renderAll();
  }

  get activeContext(): string | null {
    return this.#activeContext;
  }

  connectedCallback() {
    this.addEventListener("click", this);
    if (this.#actor) this.#renderAll();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this);
    this.#flow?.destroy();
    this.#flow = null;
    render("", this);
  }

  handleEvent(e: MouseEvent) {
    if (this.#settingsOpen && !this.contains(e.target as Node)) {
      this.#settingsOpen = false;
      this.#renderAll();
    }
  }

  #layoutOptions(): LayoutOptions {
    return { direction: this.#direction, ranksep: this.#ranksep, router: this.#router };
  }

  #internalIds(): Set<string> {
    const internal = (this.#actor?.options as { internal?: Array<{ id: string }> })?.internal;
    return new Set(internal?.map((e) => e.id) ?? []);
  }

  #resolveEdgeActor(edgeId: string | undefined): AnyActor | null {
    if (!edgeId || !this.#actor) return this.#actor;
    const dot = edgeId.indexOf(".");
    if (dot === -1) return this.#actor;
    const regionName = edgeId.substring(0, dot);
    return (this.#actor.regions as Record<string, AnyActor>)[regionName] ?? this.#actor;
  }

  #syncGraph() {
    const graphEl = this.querySelector<HTMLDivElement>("#graph-root");
    if (!graphEl || !this.#actor) return;
    const sampleContexts =
      this.#activeContext && this.#sampleContexts
        ? { [this.#activeContext]: this.#sampleContexts[this.#activeContext] }
        : undefined;
    const graph = buildGraph(this.#actor, this.#internalIds(), sampleContexts);
    if (this.#flow) {
      this.#flow.update(graph, this.#layoutOptions());
    } else {
      this.#flow = renderActorFlow(graphEl, {
        graph,
        layoutOptions: this.#layoutOptions(),
        onEdgeClick: (eventName, edgeId) => {
          if (eventName.startsWith("__EFFECT__")) {
            const timerMs = Number(eventName.replace("__EFFECT__", ""));
            const clock = this.#actor?.clock as { advance?: (ms: number) => void };
            if (typeof clock.advance === "function") {
              clock.advance(timerMs);
            }
            if (edgeId) highlightTransition(this.#flow!.graph, edgeId);
            this.#renderAll();
            return;
          }
          const target = this.#resolveEdgeActor(edgeId);
          target?.send(event(eventName)() as AnyEventRef);
          if (edgeId) highlightTransition(this.#flow!.graph, edgeId);
          this.#renderAll();
        },
      });
    }
  }

  #renderAll() {
    const graph = this.#actor
      ? buildGraph(
          this.#actor,
          this.#internalIds(),
          this.#activeContext && this.#sampleContexts
            ? { [this.#activeContext]: this.#sampleContexts[this.#activeContext] }
            : undefined,
        )
      : null;
    const stats = graph
      ? this.#actorStats(graph)
      : { states: 0, events: 0, effects: 0, regions: 0 };
    const lifecycle = this.#lifecycleStatus();
    const contextFields = this.#contextPreview();

    render(
      html`
        <style>
          :host {
            display: block;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
          }
          .identity-card {
            padding: 0.5rem 0.75rem;
            background: #1e293b;
            border-bottom: 1px solid #334155;
          }
          .identity-header {
            display: flex;
            align-items: center;
            gap: 0.4rem;
          }
          .lifecycle-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
          }
          .lifecycle-dot.running {
            background: #22c55e;
            box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
          }
          .lifecycle-dot.idle {
            background: #94a3b8;
          }
          .lifecycle-dot.done {
            background: transparent;
            border: 2px solid #64748b;
          }
          .lifecycle-dot.error {
            background: #ef4444;
            box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
          }
          .actor-name {
            font-size: 0.85rem;
            font-weight: 700;
            color: #e2e8f0;
          }
          .stats-bar {
            font-size: 0.7rem;
            color: #94a3b8;
            margin-top: 0.15rem;
          }
          .stats-bar .sep {
            color: #475569;
            margin: 0 0.1rem;
          }
          .stats-bar .val {
            color: #cbd5e1;
            font-weight: 600;
          }
          .identity-detail {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-top: 0.2rem;
            font-size: 0.7rem;
          }
          .current-state {
            color: #94a3b8;
          }
          .current-state span {
            color: #60a5fa;
            font-weight: 700;
          }
          .context-preview {
            color: #64748b;
          }
          .context-preview span {
            color: #94a3b8;
          }
          .toolbar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 0.5rem 1rem;
            background: #0f172a;
            border-bottom: 1px solid #1e293b;
            gap: 0.5rem;
            position: relative;
          }
          .gear {
            font-size: 1rem;
            padding: 0 0.6rem;
            height: 1.75rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #475569;
            border-radius: 4px;
            background: transparent;
            color: #94a3b8;
            cursor: pointer;
            box-sizing: border-box;
            appearance: none;
            -webkit-appearance: none;
          }
          .gear:hover {
            background: #334155;
            color: #e2e8f0;
          }
          .gear.open {
            background: #334155;
            border-color: #3b82f6;
            color: #3b82f6;
          }
          .settings {
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 4px;
            background: #1e293b;
            border: 1px solid #475569;
            border-radius: 6px;
            padding: 0.75rem;
            z-index: 10;
            min-width: 180px;
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
          }
          .settings label {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.8rem;
            color: #94a3b8;
            gap: 0.5rem;
          }
          .settings select {
            font-family: inherit;
            font-size: 0.8rem;
            padding: 0.2rem 0.4rem;
            border: 1px solid #475569;
            border-radius: 3px;
            background: #0f172a;
            color: #e2e8f0;
          }
          .settings input[type="range"] {
            width: 120px;
          }
          .settings .val {
            font-size: 0.75rem;
            color: #e2e8f0;
            min-width: 2em;
            text-align: right;
          }
          .graph-wrap {
            position: relative;
            height: 400px;
          }
          #graph-root {
            width: 100%;
            height: 100%;
          }
          .zoom-ctrl {
            position: absolute;
            bottom: 8px;
            left: 8px;
            display: flex;
            gap: 1px;
            z-index: 10;
            background: #1e293b;
            border: 1px solid #475569;
            border-radius: 6px;
            overflow: hidden;
          }
          .zoom-ctrl button {
            font-family: inherit;
            font-size: 1rem;
            width: 32px;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: transparent;
            color: #e2e8f0;
            cursor: pointer;
            padding: 0;
          }
          .zoom-ctrl button:hover {
            background: #334155;
          }
          .zoom-ctrl button:active {
            background: #475569;
          }
          .event-palette {
            border-top: 1px solid #1e293b;
            background: #0f172a;
          }
          .event-category {
            padding: 0.5rem 1rem;
            border-bottom: 1px solid #1e293b;
          }
          .event-category:last-child {
            border-bottom: none;
          }
          .event-category-header {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            font-weight: 600;
            margin-bottom: 0.35rem;
          }
          .event-btns {
            display: flex;
            gap: 0.4rem;
            flex-wrap: wrap;
          }
          .event-btn {
            font-family: inherit;
            font-size: 0.8rem;
            padding: 0.25rem 0.6rem;
            height: 1.75rem;
            display: inline-flex;
            align-items: center;
            border-radius: 4px;
            cursor: pointer;
            white-space: nowrap;
            box-sizing: border-box;
            appearance: none;
            -webkit-appearance: none;
            font-weight: 600;
          }
          .event-btn.primary {
            background: #1d4ed8;
            border: 1px solid #3b82f6;
            color: #e2e8f0;
          }
          .event-btn.primary:hover {
            background: #2563eb;
          }
          .event-btn.edge {
            background: transparent;
            border: 1px solid #475569;
            color: #94a3b8;
          }
          .event-btn.edge:hover {
            background: #1e293b;
            color: #e2e8f0;
          }
          .event-btn.internal {
            background: transparent;
            border: 1px solid #334155;
            color: #64748b;
            cursor: default;
            font-weight: 400;
            font-size: 0.75rem;
          }
          .ctx-wrap {
            border-top: 1px solid #e2e8f0;
            max-height: 300px;
            overflow-y: auto;
          }
          transition-timeline {
            display: block;
            border-top: 1px solid #1e293b;
          }
        </style>
        <div class="identity-card">
          <div class="identity-header">
            <div class="lifecycle-dot ${lifecycle}"></div>
            <span class="actor-name">${this.#name}</span>
          </div>
          <div class="stats-bar">
            <span class="val">${stats.states}</span> states
            <span class="sep">·</span>
            <span class="val">${stats.events}</span> events
            ${stats.effects > 0
              ? html`
                  <span class="sep">·</span>
                  <span class="val">${stats.effects}</span> effects
                `
              : ""}
            ${stats.regions > 0
              ? html`
                  <span class="sep">·</span>
                  <span class="val">${stats.regions}</span> regions
                `
              : ""}
          </div>
          <div class="identity-detail">
            <span class="current-state">Current: <span>${this.#currentState()}</span></span>
            ${contextFields.length > 0
              ? html`
                  <span class="context-preview">
                    { <span>${contextFields.join(", ")}</span> }
                  </span>
                `
              : ""}
          </div>
        </div>
        <div class="toolbar">
          <button
            class="gear ${this.#settingsOpen ? "open" : ""}"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.#settingsOpen = !this.#settingsOpen;
              this.#renderAll();
            }}
          >
            ⚙
          </button>
          ${this.#settingsOpen
            ? html`
                <div class="settings" @click=${(e: Event) => e.stopPropagation()}>
                  ${this.#sampleContexts
                    ? html`
                        <label>
                          Context
                          <select
                            @change=${(e: Event) => {
                              this.#activeContext = (e.target as HTMLSelectElement).value || null;
                              this.#renderAll();
                            }}
                          >
                            ${Object.keys(this.#sampleContexts).map(
                              (name) => html`
                                <option value=${name} ?selected=${this.#activeContext === name}>
                                  ${name}
                                </option>
                              `,
                            )}
                          </select>
                        </label>
                      `
                    : ""}
                  <label>
                    Direction
                    <select
                      @change=${(e: Event) => {
                        this.#direction = (e.target as HTMLSelectElement).value as "TB" | "LR";
                        this.#renderAll();
                      }}
                    >
                      <option value="TB" ?selected=${this.#direction === "TB"}>Top→Bottom</option>
                      <option value="LR" ?selected=${this.#direction === "LR"}>Left→Right</option>
                    </select>
                  </label>
                  <label>
                    Router
                    <select
                      @change=${(e: Event) => {
                        this.#router = (e.target as HTMLSelectElement).value as
                          | "normal"
                          | "orth"
                          | "manhattan"
                          | "metro"
                          | "er";
                        this.#renderAll();
                      }}
                    >
                      <option value="normal" ?selected=${this.#router === "normal"}>Normal</option>
                      <option value="orth" ?selected=${this.#router === "orth"}>Orthogonal</option>
                      <option value="manhattan" ?selected=${this.#router === "manhattan"}>
                        Manhattan
                      </option>
                      <option value="metro" ?selected=${this.#router === "metro"}>Metro</option>
                      <option value="er" ?selected=${this.#router === "er"}>ER</option>
                    </select>
                  </label>
                  <label>
                    Edge length
                    <span style="display:flex;align-items:center;gap:0.3rem">
                      <input
                        type="range"
                        min=${RANKSEP_MIN}
                        max=${RANKSEP_MAX}
                        value=${this.#ranksep}
                        @input=${(e: Event) => {
                          this.#ranksep = Number((e.target as HTMLInputElement).value);
                          this.#renderAll();
                        }}
                      />
                      <span class="val">${this.#ranksep}</span>
                    </span>
                  </label>
                </div>
              `
            : ""}
        </div>
        <div class="graph-wrap">
          <div id="graph-root"></div>
          <div class="zoom-ctrl">
            <button @click=${() => this.#zoomBy(1.25)} title="Zoom in">+</button>
            <button @click=${() => this.#zoomBy(1 / 1.25)} title="Zoom out">−</button>
            <button @click=${() => this.#flow?.graph.zoomTo(1)} title="Reset zoom">1:1</button>
          </div>
        </div>
        <div class="event-palette" id="palette-root"></div>
        <transition-timeline id="timeline-root"></transition-timeline>
        <div class="ctx-wrap" id="context-root"></div>
      `,
      this,
    );

    this.#syncGraph();

    if (graph) {
      this.#renderEventPalette(graph);
    }

    const ctxRoot = this.querySelector<ContextViewer>("#context-root");
    if (ctxRoot) {
      ctxRoot.actor = this.#actor;
      ctxRoot.addEventListener("context-edit", () => this.#renderAll());
    }

    const timelineRoot =
      this.querySelector<InstanceType<typeof TransitionTimeline>>("#timeline-root");
    if (timelineRoot) {
      timelineRoot.actor = this.#actor;
    }
  }

  #currentState(): string {
    if (!this.#actor) return "—";
    const snap = this.#actor.snapshot();
    return snap.path?.[snap.path.length - 1] ?? "—";
  }

  #actorStats(graph: ActorGraph): {
    states: number;
    events: number;
    effects: number;
    regions: number;
  } {
    if (!this.#actor) return { states: 0, events: 0, effects: 0, regions: 0 };
    const states = graph.nodes.filter((n) => !n.isInitial).length;
    const events = new Set(
      graph.edges.map((e) => e.label).filter((l) => l && !l.startsWith("effect:")),
    ).size;
    const effects = graph.edges.filter((e) => e.isInternal && e.source === e.target).length;
    const regions = Object.keys(this.#actor.regions || {}).length;
    return { states, events, effects, regions };
  }

  #lifecycleStatus(): "running" | "idle" | "done" | "error" {
    if (!this.#actor) return "idle";
    const snap = this.#actor.snapshot();
    if (snap.done) return "done";
    return "running";
  }

  #contextPreview(): string[] {
    if (!this.#actor?.context) return [];
    const ctx = this.#actor.context;
    if (typeof ctx !== "object") return [];
    return Object.entries(ctx)
      .filter(([, v]) => v !== undefined && v !== null)
      .slice(0, 3)
      .map(([k]) => k);
  }

  #categorizeEvents(graph: ActorGraph): EventCategory[] {
    if (!this.#actor) return [];
    const transitions = this.#actor.options?.transitions as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!transitions) return [];

    const activeNames = graph.nodes
      .filter((n: GraphNode) => n.isActive)
      .map((n: GraphNode) => n.label);

    const primary = new Set<string>();
    const edgeCases = new Set<string>();
    const internal = new Set<string>();

    const internalIds = this.#internalIds();

    for (const name of activeNames) {
      const st = transitions[name];
      if (st) {
        for (const k of Object.keys(st)) {
          if (internalIds.has(k)) {
            internal.add(k);
          } else {
            primary.add(k);
          }
        }
      }
    }

    const anyTransitions = transitions["Any"];
    if (anyTransitions) {
      for (const k of Object.keys(anyTransitions)) {
        if (!primary.has(k) && !internal.has(k)) {
          if (internalIds.has(k)) {
            internal.add(k);
          } else {
            edgeCases.add(k);
          }
        }
      }
    }

    const categories: EventCategory[] = [];
    if (primary.size > 0) {
      categories.push({ name: "Primary", events: [...primary].sort(), isInternal: false });
    }
    if (edgeCases.size > 0) {
      categories.push({ name: "Edge Cases", events: [...edgeCases].sort(), isInternal: false });
    }
    if (internal.size > 0) {
      categories.push({ name: "Internal", events: [...internal].sort(), isInternal: true });
    }
    return categories;
  }

  #zoomBy(factor: number): void {
    const g = this.#flow?.graph;
    if (!g) return;
    const MIN = 0.2;
    const MAX = 4;
    const next = Math.max(MIN, Math.min(MAX, g.zoom() * factor));
    g.zoomTo(next);
  }

  #renderEventPalette(graph: ActorGraph) {
    const categories = this.#categorizeEvents(graph);
    const paletteRoot = this.querySelector<HTMLDivElement>("#palette-root");
    if (!paletteRoot) return;

    if (categories.length === 0) {
      render(html``, paletteRoot);
      return;
    }

    render(
      html`
        ${categories.map(
          (cat) => html`
            <div class="event-category">
              <div class="event-category-header">
                ${cat.isInternal ? "▷" : cat.name === "Primary" ? "▶" : "▷"} ${cat.name}
              </div>
              <div class="event-btns">
                ${cat.events.map(
                  (name) => html`
                    <button
                      class="event-btn ${cat.isInternal
                        ? "internal"
                        : cat.name === "Primary"
                          ? "primary"
                          : "edge"}"
                      ?disabled=${cat.isInternal}
                      @click=${() => {
                        if (!cat.isInternal) {
                          this.#actor?.send(event(name)() as AnyEventRef);
                          this.#renderAll();
                        }
                      }}
                    >
                      ${name}
                    </button>
                  `,
                )}
              </div>
            </div>
          `,
        )}
      `,
      paletteRoot,
    );
  }
}

customElements.define("mantaq-viz", MantaqViz);
