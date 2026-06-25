import { html, render } from "lit-html";
import { event } from "@mantaq/core";
import type { AnyActor, AnyEventRef } from "@mantaq/core";
import { buildGraph } from "../graph.ts";
import { GraphSyncController } from "../controllers/graph-sync-controller.ts";
import type { ContextViewer } from "./context-viewer.ts";
import "./context-viewer.ts";
import { TransitionTimeline } from "./transition-timeline.ts";
import "./transition-timeline.ts";
import type { ActorGraph, GraphNode } from "../graph.ts";
import type { LayoutOptions } from "../layout.ts";
import sharedStyles from "../styles.css?inline";

const RANKSEP_DEFAULT = 100;
const RANKSEP_MIN = 20;
const RANKSEP_MAX = 320;

interface EventCategory {
  name: string;
  events: string[];
  isInternal: boolean;
}

// FIXME: MantaqViz holds 9 configurable fields (#actor/#name/#direction/#ranksep/#router/#settingsOpen/#sampleContexts/#activeContext + #flow) — collapse layout+view fields (#direction/#ranksep/#router) into a LayoutConfig object prop; collapse view fields (#sampleContexts/#activeContext/#settingsOpen) into a ViewConfig object prop. Reduces prop surface 9→3.
export class MantaqViz extends HTMLElement {
  #actor: AnyActor | null = null;
  #name: string = "Actor";
  #sync = new GraphSyncController({
    getActor: () => this.#actor,
    getGraphEl: () => this.querySelector<HTMLDivElement>("#graph-root"),
    getLayoutOptions: () => this.#layoutOptions(),
    getSampleContexts: () => this.#sampleContexts,
    getActiveContext: () => this.#activeContext,
    getInternalIds: () => this.#internalIds(),
    onRerender: () => this.#renderAll(),
  });
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
    this.#sync.destroy();
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

    const dotCls = {
      running:
        "w-2 h-2 rounded-full flex-shrink-0 bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]",
      idle: "w-2 h-2 rounded-full flex-shrink-0 bg-slate-400",
      done: "w-2 h-2 rounded-full flex-shrink-0 bg-transparent border-2 border-slate-500",
      error: "w-2 h-2 rounded-full flex-shrink-0 bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]",
    };

    render(
      html`
        <style>
          ${sharedStyles} :host {
            display: block;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
          }
        </style>
        <div class="viz-card">
          <div class="flex items-center gap-1.5">
            <div class="${dotCls[lifecycle]}"></div>
            <span class="text-sm font-bold text-slate-200">${this.#name}</span>
          </div>
          <div class="text-xs text-slate-400 mt-0.5">
            <span class="text-slate-300 font-semibold">${stats.states}</span> states
            <span class="text-slate-600 mx-0.5">·</span>
            <span class="text-slate-300 font-semibold">${stats.events}</span> events
            ${stats.effects > 0
              ? html`
                  <span class="text-slate-600 mx-0.5">·</span>
                  <span class="text-slate-300 font-semibold">${stats.effects}</span> effects
                `
              : ""}
            ${stats.regions > 0
              ? html`
                  <span class="text-slate-600 mx-0.5">·</span>
                  <span class="text-slate-300 font-semibold">${stats.regions}</span> regions
                `
              : ""}
          </div>
          <div class="flex items-center gap-3 mt-0.5 text-xs">
            <span class="text-slate-400"
              >Current: <span class="text-blue-400 font-bold">${this.#currentState()}</span></span
            >
            ${contextFields.length > 0
              ? html`
                  <span class="text-slate-500">
                    { <span class="text-slate-400">${contextFields.join(", ")}</span> }
                  </span>
                `
              : ""}
          </div>
        </div>
        <div class="viz-toolbar">
          <button
            class="viz-gear ${this.#settingsOpen ? "viz-gear-open" : ""}"
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
                <div class="viz-settings" @click=${(e: Event) => e.stopPropagation()}>
                  ${this.#sampleContexts
                    ? html`
                        <label class="viz-settings-label">
                          Context
                          <select
                            class="viz-settings-select"
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
                  <label class="viz-settings-label">
                    Direction
                    <select
                      class="viz-settings-select"
                      @change=${(e: Event) => {
                        this.#direction = (e.target as HTMLSelectElement).value as "TB" | "LR";
                        this.#renderAll();
                      }}
                    >
                      <option value="TB" ?selected=${this.#direction === "TB"}>Top→Bottom</option>
                      <option value="LR" ?selected=${this.#direction === "LR"}>Left→Right</option>
                    </select>
                  </label>
                  <label class="viz-settings-label">
                    Router
                    <select
                      class="viz-settings-select"
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
                  <label class="viz-settings-label">
                    Edge length
                    <span class="flex items-center gap-1">
                      <input
                        type="range"
                        class="w-30"
                        min=${RANKSEP_MIN}
                        max=${RANKSEP_MAX}
                        value=${this.#ranksep}
                        @input=${(e: Event) => {
                          this.#ranksep = Number((e.target as HTMLInputElement).value);
                          this.#renderAll();
                        }}
                      />
                      <span class="text-xs text-slate-200 min-w-5 text-right"
                        >${this.#ranksep}</span
                      >
                    </span>
                  </label>
                </div>
              `
            : ""}
        </div>
        <div class="relative h-100">
          <div id="graph-root" class="w-full h-full"></div>
          <div
            class="absolute bottom-2 left-2 flex gap-px z-10 bg-slate-800 border border-slate-600 rounded-md overflow-hidden"
          >
            <button class="viz-zoom-btn" @click=${() => this.#zoomBy(1.25)} title="Zoom in">
              +
            </button>
            <button class="viz-zoom-btn" @click=${() => this.#zoomBy(1 / 1.25)} title="Zoom out">
              −
            </button>
            <button
              class="viz-zoom-btn"
              @click=${() => this.#sync.graph?.zoomTo(1)}
              title="Reset zoom"
            >
              1:1
            </button>
          </div>
        </div>
        <div class="bg-slate-900 border-t border-slate-800" id="palette-root"></div>
        <transition-timeline id="timeline-root"></transition-timeline>
        <div
          class="border-t border-gray-200 max-h-75 overflow-y-auto viz-scrollbar-light"
          id="context-root"
        ></div>
      `,
      this,
    );

    this.#sync.sync();

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

  #isInternal(name: string, internalIds: Set<string>, internal: Set<string>): boolean {
    if (!internalIds.has(name)) return false;
    internal.add(name);
    return true;
  }

  #categorizeEvents(graph: ActorGraph): EventCategory[] {
    if (!this.#actor) return [];

    const activeNames = graph.nodes
      .filter((n: GraphNode) => n.isActive)
      .map((n: GraphNode) => n.label);

    const primary = new Set<string>();
    const edgeCases = new Set<string>();
    const internal = new Set<string>();
    const internalIds = this.#internalIds();
    const transitions = this.#actor.options?.transitions ?? {};

    for (const name of activeNames) {
      const st = transitions[name];
      if (!st) continue;
      for (const k of Object.keys(st)) {
        if (!this.#isInternal(k, internalIds, internal)) primary.add(k);
      }
    }

    for (const k of Object.keys(transitions["Any"] ?? {})) {
      if (primary.has(k) || internal.has(k)) continue;
      if (!this.#isInternal(k, internalIds, internal)) edgeCases.add(k);
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
    const g = this.#sync.graph;
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

    const btnCls = (cat: EventCategory) => {
      if (cat.isInternal) return "viz-event-btn viz-event-internal";
      if (cat.name === "Primary") return "viz-event-btn viz-event-primary";
      return "viz-event-btn viz-event-edge";
    };

    render(
      html`
        ${categories.map(
          (cat) => html`
            <div class="px-4 py-2 border-b border-slate-800 last:border-b-0">
              <div class="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
                ${cat.isInternal ? "▷" : cat.name === "Primary" ? "▶" : "▷"} ${cat.name}
              </div>
              <div class="flex gap-1.5 flex-wrap">
                ${cat.events.map(
                  (name) => html`
                    <button
                      class="${btnCls(cat)}"
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
