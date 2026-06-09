import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { atom } from "nanostores";
import { $layout, $selectedNodeId, $pan } from "../graph-store.ts";

export const $goToDialogVisible = atom(false);
export const $goToQuery = atom("");
export const $goToResults = atom<string[]>([]);
export const $goToSelectedIndex = atom(0);

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (lower.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function updateResults(): void {
  const layout = $layout.get();
  const query = $goToQuery.get().trim();
  if (!layout || !query) {
    $goToResults.set([]);
    $goToSelectedIndex.set(0);
    return;
  }
  const matches: string[] = [];
  for (const node of layout.nodes) {
    if (fuzzyMatch(node.label, query)) {
      matches.push(node.id);
    }
  }
  $goToResults.set(matches);
  $goToSelectedIndex.set(0);
}

export function setGoToQuery(query: string): void {
  $goToQuery.set(query);
  updateResults();
}

export function openGoToDialog(): void {
  $goToQuery.set("");
  $goToResults.set([]);
  $goToSelectedIndex.set(0);
  $goToDialogVisible.set(true);
}

export function closeGoToDialog(): void {
  $goToDialogVisible.set(false);
  $goToQuery.set("");
  $goToResults.set([]);
  $goToSelectedIndex.set(0);
}

function panToNode(nodeId: string): void {
  const layout = $layout.get();
  if (!layout) return;
  const node = layout.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const graphEl = document.querySelector("actor-graph");
  if (!graphEl) return;
  const rect = graphEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const zoom = 1;
  $pan.set({
    x: rect.width / 2 - (node.x + node.width / 2) * zoom,
    y: rect.height / 2 - (node.y + node.height / 2) * zoom,
  });
}

export function goToNode(nodeId: string): void {
  $selectedNodeId.set(nodeId);
  panToNode(nodeId);
  closeGoToDialog();
}

export function goToNextResult(): void {
  const results = $goToResults.get();
  if (results.length === 0) return;
  const idx = ($goToSelectedIndex.get() + 1) % results.length;
  $goToSelectedIndex.set(idx);
}

export function goToPrevResult(): void {
  const results = $goToResults.get();
  if (results.length === 0) return;
  const idx = ($goToSelectedIndex.get() - 1 + results.length) % results.length;
  $goToSelectedIndex.set(idx);
}

export function goToConfirm(): void {
  const results = $goToResults.get();
  const idx = $goToSelectedIndex.get();
  if (results.length === 0) return;
  goToNode(results[idx]);
}

const STYLES = `<style>
  :host { display: block; }
  @media (prefers-reduced-motion: reduce) {
    .dialog-backdrop { transition: none; }
  }
</style>`;

export class GoToDialog extends HTMLElement {
  _shadow: ShadowRoot;
  _unsubscribers: Array<() => void> = [];
  _visible = false;
  _query = "";
  _results: string[] = [];
  _selectedIndex = 0;
  _layoutNodes: Array<{ id: string; label: string }> = [];
  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $goToDialogVisible.subscribe((v) => {
        this._visible = v;
        if (v) {
          requestAnimationFrame(() => {
            const input = this._shadow.querySelector(".dialog-input") as HTMLInputElement;
            input?.focus();
          });
        }
        this._requestRender();
      }),
      $goToQuery.subscribe((v) => {
        this._query = v;
        this._requestRender();
      }),
      $goToResults.subscribe((v) => {
        this._results = [...v];
        this._requestRender();
      }),
      $goToSelectedIndex.subscribe((v) => {
        this._selectedIndex = v;
        this._requestRender();
      }),
      $layout.subscribe((v) => {
        this._layoutNodes = v ? v.nodes.map((n) => ({ id: n.id, label: n.label })) : [];
      }),
    );
    this._requestRender();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _handleInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    setGoToQuery(input.value);
  };

  _handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeGoToDialog();
        break;
      case "ArrowDown":
        e.preventDefault();
        goToNextResult();
        break;
      case "ArrowUp":
        e.preventDefault();
        goToPrevResult();
        break;
      case "Enter":
        e.preventDefault();
        goToConfirm();
        break;
    }
  };

  _handleBackdropClick = (e: Event) => {
    if ((e.target as HTMLElement).classList.contains("dialog-backdrop")) {
      closeGoToDialog();
    }
  };

  _handleResultClick(nodeId: string) {
    goToNode(nodeId);
  }

  _requestRender() {
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });

    const content = this._visible
      ? html`<div
          class="dialog-backdrop fixed inset-0 z-[1000] flex items-start justify-center pt-[20vh] bg-black/30 backdrop-blur-[1px] opacity-0 pointer-events-none transition-opacity duration-100${this
            ._visible
            ? " open opacity-100 pointer-events-auto"
            : ""}"
          @click=${this._handleBackdropClick}
          @keydown=${this._handleKeyDown}
        >
          <div
            class="bg-[var(--viz-panel-bg,#ffffff)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-lg shadow-[0_4px_20px_rgba(0,0,0,.15)] w-[360px] max-w-[90vw] overflow-hidden dialog"
            role="dialog"
            aria-label="Go to node"
          >
            <input
              class="dialog-input w-full px-[14px] py-[10px] border-none outline-none font-mono text-[14px] text-[var(--viz-panel-text,#374151)] bg-transparent box-border placeholder:text-[var(--viz-text-muted,#9ca3af)]"
              type="text"
              placeholder="Type node name..."
              .value=${this._query}
              @input=${this._handleInput}
              aria-label="Node name"
              aria-autocomplete="list"
            />
            ${this._results.length > 0
              ? html`<div
                  class="max-h-[200px] overflow-y-auto border-t border-[var(--viz-panel-border,#e5e7eb)]"
                  role="listbox"
                >
                  ${this._results.map((id, i) => {
                    const node = this._layoutNodes.find((n) => n.id === id);
                    const label = node?.label ?? id;
                    return html`<div
                      class="px-[14px] py-[6px] font-mono text-[12px] text-[var(--viz-panel-text,#374151)] cursor-pointer transition-colors duration-100 hover:bg-[var(--viz-border,#e5e7eb)]${i ===
                      this._selectedIndex
                        ? " bg-[var(--viz-node-active-bg,#dcfce7)]"
                        : ""} result-item"
                      role="option"
                      aria-selected="${i === this._selectedIndex}"
                      @click=${() => this._handleResultClick(id)}
                    >
                      ${label}
                    </div>`;
                  })}
                </div>`
              : this._query.trim()
                ? html`<div
                    class="px-[14px] py-2 font-mono text-[12px] text-[var(--viz-text-muted,#9ca3af)] text-center no-results"
                  >
                    No matching nodes
                  </div>`
                : ""}
            <div
              class="px-[14px] pt-1 pb-2 font-mono text-[10px] text-[var(--viz-text-muted,#9ca3af)] border-t border-[var(--viz-panel-border,#e5e7eb)]"
            >
              <kbd
                class="bg-[var(--viz-panel-item-bg,#f9fafb)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-[2px] px-[3px] py-0 text-[10px]"
                >Enter</kbd
              >
              to go &middot;
              <kbd
                class="bg-[var(--viz-panel-item-bg,#f9fafb)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-[2px] px-[3px] py-0 text-[10px]"
                >Esc</kbd
              >
              to close &middot;
              <kbd
                class="bg-[var(--viz-panel-item-bg,#f9fafb)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-[2px] px-[3px] py-0 text-[10px]"
                >&uarr;</kbd
              ><kbd
                class="bg-[var(--viz-panel-item-bg,#f9fafb)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-[2px] px-[3px] py-0 text-[10px]"
                >&darr;</kbd
              >
              to navigate
            </div>
          </div>
        </div>`
      : html``;

    render(html`${unsafeHTML(STYLES)}${content}`, this._shadow);
    resolve!();
  }
}

customElements.define("go-to-dialog", GoToDialog);
