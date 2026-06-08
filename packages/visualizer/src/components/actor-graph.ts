import { html } from "lit";
import { render } from "lit/html.js";
import {
  $zoom,
  $pan,
  $selectedNodeId,
  $layout,
  $layoutError,
  $layoutLoading,
  zoomToFit,
  resetView,
  setZoom,
} from "../graph-store.ts";
import type { LayoutResult } from "../layout.ts";

const ZOOM_STEP = 0.2;

const STYLES = `<style>
  :host { display: block; position: relative; width: 100%; height: 100%; min-height: 400px; overflow: hidden; background: var(--viz-bg, #fafafa); border-radius: 8px; border: 1px solid var(--viz-border, #e5e7eb); }
  .container { width: 100%; height: 100%; overflow: hidden; cursor: grab; position: relative; outline: none; }
  .container:focus-visible { box-shadow: inset 0 0 0 2px var(--viz-accent, #3b82f6); }
  .container:active { cursor: grabbing; }
  .viewport { position: absolute; transform-origin: 0 0; will-change: transform; }
  .error { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-family: monospace; font-size: 13px; color: var(--viz-error-text, #dc2626); background: var(--viz-error-bg, #fef2f2); padding: 12px 16px; border-radius: 6px; border: 1px solid var(--viz-error-border, #fecaca); max-width: 300px; text-align: center; }
  .zoom-controls { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 4px; background: var(--viz-node-bg); border: 1px solid var(--viz-border); border-radius: 6px; padding: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .zoom-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; border-radius: 4px; font-size: 14px; color: var(--viz-node-label); transition: background .15s; }
  .zoom-btn:hover { background: var(--viz-border); }
  .zoom-indicator { font-family: monospace; font-size: 11px; color: var(--viz-text-muted, #6b7280); display: flex; align-items: center; padding: 0 6px; min-width: 40px; justify-content: center; }
  .help-overlay { position: absolute; top: 12px; right: 12px; background: var(--viz-node-bg); border: 1px solid var(--viz-border); border-radius: 6px; padding: 8px 12px; font-family: monospace; font-size: 11px; color: var(--viz-text-muted); box-shadow: 0 1px 3px rgba(0,0,0,.08); display: flex; gap: 10px; max-width: calc(100% - 24px); }
  .help-overlay kbd { background: var(--viz-border); border: 1px solid var(--viz-node-border); border-radius: 3px; padding: 0 4px; font-size: 10px; }
  .empty-state { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; font-family: monospace; color: var(--viz-text-muted, #9ca3af); }
  .empty-state-icon { margin-bottom: 8px; opacity: .5; }
  .empty-state-text { font-size: 14px; }
  .loading-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,.04); z-index: 100; }
  .spinner { width: 28px; height: 28px; border: 3px solid var(--viz-border, #e5e7eb); border-top-color: var(--viz-accent, #6366f1); border-radius: 50%; animation: spin .6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { margin-top: 10px; font-family: monospace; font-size: 12px; color: var(--viz-text-muted, #6b7280); }
  @media (max-width: 480px) { .help-overlay { display: none; } }
</style>`;

export class ActorGraphComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _drag: { active: boolean; sx: number; sy: number } = { active: false, sx: 0, sy: 0 };
  _unsubscribers: Array<() => void> = [];
  _abort: AbortController | null = null;
  _zoom = 1;
  _pan = { x: 0, y: 0 };
  _layout: LayoutResult | null = null;
  _layoutError: string | null = null;
  _layoutLoading = false;
  _selectedNodeId: string | null = null;
  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    const sub = (
      store: { subscribe: (fn: (v: any) => void) => () => void },
      fn: (v: any) => void,
    ) => this._unsubscribers.push(store.subscribe(fn));

    sub($zoom, (v) => {
      this._zoom = v;
      this._renderComponent();
    });
    sub($pan, (v) => {
      this._pan = v;
      this._renderComponent();
    });
    sub($layout, (v) => {
      const firstLayout = v && !this._layout;
      this._layout = v;
      if (firstLayout) requestAnimationFrame(() => zoomToFit());
      this._renderComponent();
    });
    sub($layoutError, (v) => {
      this._layoutError = v;
      this._renderComponent();
    });
    sub($layoutLoading, (v) => {
      this._layoutLoading = v;
      this._renderComponent();
    });
    sub($selectedNodeId, (v) => {
      this._selectedNodeId = v;
      this._renderComponent();
    });

    this._renderComponent();
    this._attachEvents();
  }

  disconnectedCallback() {
    this._abort?.abort();
    this._abort = null;
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _attachEvents() {
    const el = this._shadow.querySelector(".container");
    if (!el) return;
    this._abort = new AbortController();
    const s = this._abort.signal;
    el.addEventListener("wheel", this._handleWheel, { passive: false, signal: s });
    el.addEventListener("mousedown", this._handleMouseDown, { signal: s });
    el.addEventListener("dblclick", this._handleDblClick, { signal: s });
    el.addEventListener("node-select", this._handleNodeSelect, { signal: s });
    window.addEventListener("mousemove", this._handleMouseMove, { signal: s });
    window.addEventListener("mouseup", this._handleMouseUp, { signal: s });
  }

  _zoomAtPoint(cursorX: number, cursorY: number, newZoom: number) {
    const clamped = Math.min(Math.max(newZoom, 0.1), 5);
    const scale = clamped / this._zoom;
    setZoom(clamped);
    $pan.set({
      x: cursorX - (cursorX - this._pan.x) * scale,
      y: cursorY - (cursorY - this._pan.y) * scale,
    });
  }

  _handleWheel = (e: Event) => {
    const we = e as WheelEvent;
    we.preventDefault();
    const rect = (we.currentTarget as HTMLElement).getBoundingClientRect();
    this._zoomAtPoint(
      we.clientX - rect.left,
      we.clientY - rect.top,
      this._zoom + (we.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP),
    );
  };

  _handleMouseDown = (e: Event) => {
    if ((e.target as HTMLElement).closest("state-node")) return;
    const me = e as MouseEvent;
    this._drag = { active: true, sx: me.clientX - this._pan.x, sy: me.clientY - this._pan.y };
  };

  _handleMouseMove = (e: Event) => {
    if (!this._drag.active) return;
    $pan.set({
      x: (e as MouseEvent).clientX - this._drag.sx,
      y: (e as MouseEvent).clientY - this._drag.sy,
    });
  };

  _handleMouseUp = () => {
    this._drag.active = false;
  };

  _handleDblClick = (e: Event) => {
    const me = e as MouseEvent;
    const rect = (me.currentTarget as HTMLElement).getBoundingClientRect();
    this._zoomAtPoint(me.clientX - rect.left, me.clientY - rect.top, this._zoom + ZOOM_STEP * 2);
  };

  _handleNodeSelect = (e: Event) => {
    $selectedNodeId.set((e as CustomEvent).detail.nodeId);
  };

  _panToNode(nodeId: string) {
    const node = this._layout?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const el = this._shadow.querySelector(".container");
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    $pan.set({
      x: r.width / 2 - (node.x + node.width / 2) * this._zoom,
      y: r.height / 2 - (node.y + node.height / 2) * this._zoom,
    });
  }

  _navigateNode(delta: 1 | -1) {
    const nodes = this._layout?.nodes;
    if (!nodes?.length) return;
    const idx = nodes.findIndex((n) => n.id === this._selectedNodeId);
    const nextId = nodes[(idx + delta + nodes.length) % nodes.length].id;
    $selectedNodeId.set(nextId);
    this._panToNode(nextId);
  }

  _handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "+":
      case "=":
        setZoom(this._zoom + ZOOM_STEP);
        break;
      case "-":
        setZoom(this._zoom - ZOOM_STEP);
        break;
      case "0":
        resetView();
        break;
      case "f":
      case "F":
        zoomToFit();
        break;
      case "Escape":
        $selectedNodeId.set(null);
        break;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        this._navigateNode(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        this._navigateNode(-1);
        break;
    }
  };

  _renderComponent() {
    const {
      _layoutError: err,
      _layout: layout,
      _pan: pan,
      _zoom: zoom,
      _selectedNodeId: sel,
    } = this;
    let content;
    if (err) {
      content = html`<div class="error" role="alert">${err}</div>`;
    } else if (!layout) {
      content = html`<div class="empty-state">
        <div class="empty-state-icon">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" />
          </svg>
        </div>
        <div class="empty-state-text">No actor loaded</div>
      </div>`;
    } else {
      content = html` <div
          class="viewport"
          style="transform:translate(${pan.x}px,${pan.y}px) scale(${zoom})"
        >
          ${layout.edges.map(
            (e) => html`<edge-path
              .edgeId=${e.id}
              .path=${e.path}
              .label=${e.label}
              .isActive=${e.isActive}
              .labelX=${e.labelX}
              .labelY=${e.labelY}
              .graphWidth=${layout.width}
              .graphHeight=${layout.height}
            ></edge-path>`,
          )}
          ${layout.nodes.map(
            (n) => html`<state-node
              .nodeId=${n.id}
              .label=${n.label}
              .isActive=${n.isActive}
              .isFinal=${n.isFinal}
              .x=${n.x}
              .y=${n.y}
              .width=${n.width}
              .height=${n.height}
              .selected=${sel === n.id}
            ></state-node>`,
          )}
        </div>
        <div class="help-overlay">
          <span><kbd>+</kbd>/<kbd>-</kbd> zoom</span>
          <span><kbd>0</kbd> reset</span>
          <span><kbd>F</kbd> fit</span>
          <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> navigate</span>
          <span><kbd>Esc</kbd> deselect</span>
        </div>
        <div class="zoom-controls">
          <button
            class="zoom-btn"
            aria-label="Zoom out"
            @click=${() => setZoom(this._zoom - ZOOM_STEP)}
          >
            &minus;
          </button>
          <span class="zoom-indicator" aria-live="polite">${Math.round(zoom * 100)}%</span>
          <button
            class="zoom-btn"
            aria-label="Zoom in"
            @click=${() => setZoom(this._zoom + ZOOM_STEP)}
          >
            +
          </button>
        </div>`;
    }
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      html`${STYLES}
        <div class="container" tabindex="0" @keydown=${this._handleKeyDown}>
          ${content}
          ${this._layoutLoading
            ? html`<div class="loading-overlay" role="status">
                <div class="spinner"></div>
                <div class="loading-text">Layout computation...</div>
              </div>`
            : null}
        </div>`,
      this._shadow,
    );
    resolve!();
  }
}

customElements.define("actor-graph", ActorGraphComponent);
