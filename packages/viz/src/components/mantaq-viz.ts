import { html, render } from "lit-html";
import { event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { buildGraph } from "../graph.ts";
import { highlightTransition } from "../x6/sync.ts";
import { renderActorFlow } from "./actor-flow.ts";
import type { ActorGraph, GraphNode } from "../graph.ts";
import type { LayoutOptions } from "../layout.ts";

const RANKSEP_DEFAULT = 100;
const RANKSEP_MIN = 20;
const RANKSEP_MAX = 320;

export class MantaqViz extends HTMLElement {
  #actor: AnyActor | null = null;
  #flow: ReturnType<typeof renderActorFlow> | null = null;
  #direction: "TB" | "LR" = "LR";
  #ranksep = RANKSEP_DEFAULT;
  #router: "normal" | "orth" | "manhattan" | "metro" | "er" = "normal";
  #settingsOpen = false;

  set actor(a: AnyActor | null) {
    this.#actor = a;
    if (this.isConnected) this.#renderAll();
  }

  get actor(): AnyActor | null {
    return this.#actor;
  }

  connectedCallback() {
    document.addEventListener("click", this);
    if (this.#actor) this.#renderAll();
  }

  disconnectedCallback() {
    document.removeEventListener("click", this);
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

  #syncGraph() {
    const graphEl = this.querySelector<HTMLDivElement>("#graph-root");
    if (!graphEl) return;
    const graph = buildGraph(this.#actor!, this.#internalIds());
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
          this.#actor?.send(event(eventName)() as any);
          if (edgeId) highlightTransition(this.#flow!.graph, edgeId);
          this.#renderAll();
        },
      });
    }
    this.#renderButtons(graph);
  }

  #renderAll() {
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
          .tb {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1rem;
            background: #1e293b;
            border-bottom: 1px solid #e5e7eb;
            flex-wrap: wrap;
            gap: 0.5rem;
          }
          .tb-left {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
          .state-label {
            font-size: 0.9rem;
            color: #94a3b8;
          }
          .state-label span {
            color: #e2e8f0;
            font-weight: 700;
          }
          .tb-right {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            position: relative;
          }
          .btns {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
          }
          .btns button {
            font-family: inherit;
            font-size: 0.85rem;
            padding: 0 0.75rem;
            height: 2rem;
            display: inline-flex;
            align-items: center;
            border: 1px solid #e5e7eb;
            border-radius: 4px;
            background: #0f172a;
            color: #e2e8f0;
            cursor: pointer;
            white-space: nowrap;
            box-sizing: border-box;
            appearance: none;
            -webkit-appearance: none;
          }
          .btns button:disabled {
            opacity: 0.25;
            cursor: default;
          }
          .btns button:not(:disabled):hover {
            background: #1e293b;
          }
          .btns button:not(:disabled):active {
            background: #334155;
          }
          .gear {
            font-size: 1rem;
            padding: 0 0.6rem;
            height: 2rem;
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
            height: 400px;
            position: relative;
          }
        </style>
        <div class="tb">
          <div class="tb-left">
            <span class="state-label"
              >State: <span id="state-txt">${this.#currentState()}</span></span
            >
          </div>
          <div class="tb-right">
            <div class="btns" id="btn-root"></div>
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
                        <option value="normal" ?selected=${this.#router === "normal"}>
                          Normal
                        </option>
                        <option value="orth" ?selected=${this.#router === "orth"}>
                          Orthogonal
                        </option>
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
        </div>
        <div class="graph-wrap" id="graph-root"></div>
      `,
      this,
    );

    this.#syncGraph();
  }

  #currentState(): string {
    if (!this.#actor) return "—";
    const snap = this.#actor.snapshot();
    return snap.path?.[snap.path.length - 1] ?? "—";
  }

  #getAvailableEvents(graph: ActorGraph): string[] {
    if (!this.#actor) return [];
    const activeNames = graph.nodes
      .filter((n: GraphNode) => n.isActive)
      .map((n: GraphNode) => n.label);
    const avail = new Set<string>();
    const transitions = this.#actor.options?.transitions as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (transitions) {
      for (const name of activeNames) {
        const st = transitions[name];
        if (st) for (const k of Object.keys(st)) avail.add(k);
      }
    }
    return [...avail].sort();
  }

  #renderButtons(graph: ActorGraph) {
    const available = this.#getAvailableEvents(graph);
    const btnRoot = this.querySelector<HTMLDivElement>("#btn-root");
    if (!btnRoot) return;

    render(
      html`
        ${available.map(
          (name) => html`
            <button
              @click=${() => {
                this.#actor?.send(event(name)() as any);
                this.#renderAll();
              }}
            >
              ${name}
            </button>
          `,
        )}
      `,
      btnRoot,
    );
  }
}

customElements.define("mantaq-viz", MantaqViz);
