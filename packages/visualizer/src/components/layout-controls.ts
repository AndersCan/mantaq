import { html } from "lit";
import { render } from "lit/html.js";
import {
  $layoutAlgorithm,
  $edgeRouting,
  $layoutAnimation,
  $activePreset,
  $autoSize,
  LAYOUT_PRESETS,
  setLayoutAlgorithm,
  setEdgeRouting,
  toggleLayoutAnimation,
  toggleAutoSize,
  applyPreset,
} from "../graph-store.ts";
import type { LayoutAlgorithm, EdgeRouting } from "../graph-store.ts";

const STYLES = `<style>
  :host { display: inline-flex; align-items: center; gap: 4px; }
  .dropdown-group + .dropdown-group { border-top: 1px solid var(--viz-border, #e5e7eb); margin-top: 4px; padding-top: 4px; }
</style>`;

const ALGORITHMS: { value: LayoutAlgorithm; label: string }[] = [
  { value: "layered", label: "Layered" },
  { value: "force", label: "Force" },
  { value: "stress", label: "Stress" },
  { value: "mrtree", label: "Tree" },
];

const EDGE_ROUTES: { value: EdgeRouting; label: string }[] = [
  { value: "orthogonal", label: "Orthogonal" },
  { value: "spline", label: "Spline" },
  { value: "polyline", label: "Polyline" },
];

const ICON = html`<svg
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="3" y="3" width="7" height="7" />
  <rect x="14" y="3" width="7" height="7" />
  <rect x="3" y="14" width="7" height="7" />
  <rect x="14" y="14" width="7" height="7" />
</svg>`;

export class LayoutControlsComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _open = false;
  _algorithm: LayoutAlgorithm = "layered";
  _edgeRouting: EdgeRouting = "orthogonal";
  _layoutAnimation = true;
  _activePreset: string | null = null;
  _autoSize = false;
  _unsubscribers: Array<() => void> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $layoutAlgorithm.subscribe((v) => {
        this._algorithm = v;
        this._render();
      }),
      $edgeRouting.subscribe((v) => {
        this._edgeRouting = v;
        this._render();
      }),
      $layoutAnimation.subscribe((v) => {
        this._layoutAnimation = v;
        this._render();
      }),
      $activePreset.subscribe((v) => {
        this._activePreset = v;
        this._render();
      }),
      $autoSize.subscribe((v) => {
        this._autoSize = v;
        this._render();
      }),
    );
    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _toggle = () => {
    this._open = !this._open;
    this._render();
    if (this._open) {
      const handler = (e: MouseEvent) => {
        if (!this.contains(e.target as Node)) {
          this._open = false;
          this._render();
          document.removeEventListener("mousedown", handler);
        }
      };
      document.addEventListener("mousedown", handler);
    }
  };

  _selectAlgorithm = (algo: LayoutAlgorithm) => {
    setLayoutAlgorithm(algo);
  };

  _selectEdgeRouting = (routing: EdgeRouting) => {
    setEdgeRouting(routing);
  };

  _selectPreset = (key: string) => {
    applyPreset(key);
  };

  _toggleAnim = () => {
    toggleLayoutAnimation();
  };

  _toggleAutoSize = () => {
    toggleAutoSize();
  };

  _render() {
    const presetKeys = Object.keys(LAYOUT_PRESETS);
    render(
      html`${STYLES}
        <div class="relative inline-flex">
          <button
            class="w-7 h-7 flex items-center justify-center border-none bg-[var(--viz-node-bg,#ffffff)] cursor-pointer rounded text-[var(--viz-node-label,#374151)] transition-colors duration-150 border border-[var(--viz-border,#e5e7eb)] text-xs font-mono hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2 layout-btn${this
              ._open
              ? " !bg-[var(--viz-accent,#6366f1)] !text-white !border-[var(--viz-accent,#6366f1)] active"
              : ""}"
            aria-label="Layout options"
            title="Layout options"
            @click=${this._toggle}
          >
            ${ICON}
          </button>
          ${this._open
            ? html`<div
                class="absolute top-full right-0 mt-1 bg-[var(--viz-node-bg,#ffffff)] border border-[var(--viz-border,#e5e7eb)] rounded-md p-1 shadow-[0_2px_8px_rgba(0,0,0,.12)] z-100 min-w-[180px] max-h-[400px] overflow-y-auto dropdown"
                role="menu"
              >
                <div class="dropdown-group">
                  <div
                    class="font-mono text-[10px] text-[var(--viz-text-muted,#6b7280)] px-2 py-0.5"
                  >
                    Presets
                  </div>
                  ${presetKeys.map(
                    (key) => html`<button
                      class="block w-full text-left border-none bg-transparent cursor-pointer px-2 py-1 font-mono text-[11px] text-[var(--viz-node-label,#374151)] rounded transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] dropdown-item${this
                        ._activePreset === key
                        ? " !bg-[var(--viz-accent,#6366f1)] !text-white"
                        : ""}"
                      role="menuitem"
                      @click=${() => this._selectPreset(key)}
                    >
                      ${LAYOUT_PRESETS[key].name}
                    </button>`,
                  )}
                </div>
                <div class="dropdown-group">
                  <div
                    class="font-mono text-[10px] text-[var(--viz-text-muted,#6b7280)] px-2 py-0.5"
                  >
                    Algorithm
                  </div>
                  ${ALGORITHMS.map(
                    (a) => html`<button
                      class="block w-full text-left border-none bg-transparent cursor-pointer px-2 py-1 font-mono text-[11px] text-[var(--viz-node-label,#374151)] rounded transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] dropdown-item${this
                        ._algorithm === a.value
                        ? " !bg-[var(--viz-accent,#6366f1)] !text-white"
                        : ""}"
                      role="menuitem"
                      @click=${() => this._selectAlgorithm(a.value)}
                    >
                      ${a.label}
                    </button>`,
                  )}
                </div>
                <div class="dropdown-group">
                  <div
                    class="font-mono text-[10px] text-[var(--viz-text-muted,#6b7280)] px-2 py-0.5"
                  >
                    Edge routing
                  </div>
                  ${EDGE_ROUTES.map(
                    (r) => html`<button
                      class="block w-full text-left border-none bg-transparent cursor-pointer px-2 py-1 font-mono text-[11px] text-[var(--viz-node-label,#374151)] rounded transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] dropdown-item${this
                        ._edgeRouting === r.value
                        ? " !bg-[var(--viz-accent,#6366f1)] !text-white"
                        : ""}"
                      role="menuitem"
                      @click=${() => this._selectEdgeRouting(r.value)}
                    >
                      ${r.label}
                    </button>`,
                  )}
                </div>
                <div class="dropdown-group">
                  <div class="flex items-center gap-1.5 px-2 py-1">
                    <input
                      type="checkbox"
                      id="layout-anim"
                      .checked=${this._layoutAnimation}
                      @change=${this._toggleAnim}
                    />
                    <label
                      class="font-mono text-[11px] text-[var(--viz-node-label,#374151)]"
                      for="layout-anim"
                      >Animate layout</label
                    >
                  </div>
                  <div class="flex items-center gap-1.5 px-2 py-1">
                    <input
                      type="checkbox"
                      id="auto-size"
                      .checked=${this._autoSize}
                      @change=${this._toggleAutoSize}
                    />
                    <label
                      class="font-mono text-[11px] text-[var(--viz-node-label,#374151)]"
                      for="auto-size"
                      >Auto-size nodes</label
                    >
                  </div>
                </div>
              </div>`
            : ""}
        </div>`,
      this._shadow,
    );
  }
}

customElements.define("layout-controls", LayoutControlsComponent);
