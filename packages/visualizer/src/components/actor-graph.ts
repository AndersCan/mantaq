import { html } from "lit";
import { render } from "lit/html.js";
import {
  $zoom,
  $pan,
  $selectedNodeId,
  $layout,
  $layoutError,
  $lastTransition,
  $layoutAnimation,
  zoomToFit,
  resetView,
  setZoom,
} from "../graph-store.ts";
import type { LayoutResult } from "../layout.ts";
import type { NodeSelectDetail } from "../types.ts";
import { isWheelEvent, isMouseEvent, isTouchEvent, isCustomEvent } from "../types.ts";

const ZOOM_STEP = 0.2;

const STYLES = `<style>
  :host { display: block; position: relative; width: 100%; height: 100%; min-height: 300px; overflow: hidden; background: var(--viz-bg, #fafafa); border-radius: 8px; border: 1px solid var(--viz-border, #e5e7eb); }
  .container:active { cursor: grabbing; }
  .zoom-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: none; background: var(--viz-node-bg, #fff); cursor: pointer; border-radius: 4px; font-size: 14px; color: var(--viz-node-label, #374151); border: 1px solid var(--viz-border, #e5e7eb); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .zoom-btn:hover { background: var(--viz-border, #e5e7eb); }
  .zoom-controls { display: flex; gap: 1px; align-items: center; background: var(--viz-node-bg, #fff); border: 1px solid var(--viz-border, #e5e7eb); border-radius: 6px; padding: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .zoom-indicator { font-family: monospace; font-size: 11px; color: var(--viz-text-muted, #6b7280); min-width: 40px; text-align: center; user-select: none; }
  .fit-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: none; background: var(--viz-node-bg, #fff); cursor: pointer; border-radius: 4px; font-size: 12px; color: var(--viz-node-label, #374151); border: 1px solid var(--viz-border, #e5e7eb); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .fit-btn:hover { background: var(--viz-border, #e5e7eb); }
  .controls { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 6px; align-items: center; z-index: 10; }
</style>`;

export class ActorGraphComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _drag: { active: boolean; sx: number; sy: number } = { active: false, sx: 0, sy: 0 };
  _touch = {
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    pinchDist: 0,
    pinchZoom: 1,
    pinchCenterX: 0,
    pinchCenterY: 0,
  };
  _unsubscribers: Array<() => void> = [];
  _abort: AbortController | null = null;
  _zoom = 1;
  _pan = { x: 0, y: 0 };
  _layout: LayoutResult | null = null;
  _layoutError: string | null = null;
  _selectedNodeId: string | null = null;
  _layoutAnimation = true;
  _lastTransition: {
    activatedNodes?: string[];
    deactivatedNodes?: string[];
    activatedEdges?: string[];
  } | null = null;
  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $zoom.subscribe((v) => {
        this._zoom = v;
        this._updateViewportTransform();
      }),
      $pan.subscribe((v) => {
        this._pan = v;
        this._updateViewportTransform();
      }),
      $layout.subscribe((v) => {
        const firstLayout = v && !this._layout;
        this._layout = v;
        if (firstLayout) requestAnimationFrame(() => zoomToFit());
        this._requestRender();
      }),
      $layoutError.subscribe((v) => {
        this._layoutError = v;
        this._requestRender();
      }),
      $selectedNodeId.subscribe((v) => {
        this._selectedNodeId = v;
        this._requestRender();
      }),
      $layoutAnimation.subscribe((v) => {
        this._layoutAnimation = v;
        this._requestRender();
      }),
      $lastTransition.subscribe((v) => {
        this._lastTransition = v;
        this._requestRender();
      }),
    );

    this._requestRender();
    this._attachEvents();
  }

  disconnectedCallback() {
    this._abort?.abort();
    this._abort = null;
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _attachEvents() {
    try {
      const el = this._shadow.querySelector(".container");
      if (!el) return;
      this._abort = new AbortController();
      const s = this._abort.signal;
      el.addEventListener("wheel", this._handleWheel, { passive: false, signal: s });
      el.addEventListener("mousedown", this._handleMouseDown, { signal: s });
      el.addEventListener("node-select", this._handleNodeSelect, { signal: s });
      el.addEventListener("touchstart", this._handleTouchStart, { passive: false, signal: s });
      el.addEventListener("touchmove", this._handleTouchMove, { passive: false, signal: s });
      el.addEventListener("touchend", this._handleTouchEnd, { signal: s });
      window.addEventListener("mousemove", this._handleMouseMove, { signal: s });
      window.addEventListener("mouseup", this._handleMouseUp, { signal: s });
    } catch {
      // Event attachment failed - non-critical
    }
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
    if (!isWheelEvent(e)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._zoomAtPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
      this._zoom + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP),
    );
  };

  _handleMouseDown = (e: Event) => {
    if ((e.target as HTMLElement).closest("state-node")) return;
    if (!isMouseEvent(e)) return;
    this._drag = { active: true, sx: e.clientX - this._pan.x, sy: e.clientY - this._pan.y };
  };

  _handleMouseMove = (e: Event) => {
    if (!this._drag.active || !isMouseEvent(e)) return;
    this._pan = {
      x: e.clientX - this._drag.sx,
      y: e.clientY - this._drag.sy,
    };
    this._updateViewportTransform();
  };

  _handleMouseUp = () => {
    if (this._drag.active) {
      $pan.set(this._pan);
    }
    this._drag.active = false;
  };

  _handleNodeSelect = (e: Event) => {
    if (!isCustomEvent(e)) return;
    const detail = e.detail as NodeSelectDetail;
    $selectedNodeId.set(detail.nodeId);
  };

  _getTouchDist(t: TouchList): number {
    if (t.length < 2) return 0;
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _getTouchCenter(t: TouchList): { x: number; y: number } {
    if (t.length < 2) return { x: t[0].clientX, y: t[0].clientY };
    return {
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    };
  }

  _handleTouchStart = (e: Event) => {
    if (!isTouchEvent(e)) return;
    if ((e.target as HTMLElement).closest("state-node")) return;
    e.preventDefault();
    const touches = e.touches;

    if (touches.length === 1) {
      this._touch.active = true;
      this._touch.startX = touches[0].clientX;
      this._touch.startY = touches[0].clientY;
      this._touch.startPanX = this._pan.x;
      this._touch.startPanY = this._pan.y;
    } else if (touches.length === 2) {
      this._touch.active = false;
      this._touch.pinchDist = this._getTouchDist(touches);
      this._touch.pinchZoom = this._zoom;
      const center = this._getTouchCenter(touches);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._touch.pinchCenterX = center.x - rect.left;
      this._touch.pinchCenterY = center.y - rect.top;
    }
  };

  _handleTouchMove = (e: Event) => {
    if (!isTouchEvent(e)) return;
    e.preventDefault();
    const touches = e.touches;

    if (touches.length === 1 && this._touch.active) {
      const dx = touches[0].clientX - this._touch.startX;
      const dy = touches[0].clientY - this._touch.startY;
      this._pan = {
        x: this._touch.startPanX + dx,
        y: this._touch.startPanY + dy,
      };
      this._updateViewportTransform();
    } else if (touches.length === 2) {
      const newDist = this._getTouchDist(touches);
      if (this._touch.pinchDist > 0) {
        const scale = newDist / this._touch.pinchDist;
        const newZoom = this._touch.pinchZoom * scale;
        this._zoomAtPoint(this._touch.pinchCenterX, this._touch.pinchCenterY, newZoom);
      }
    }
  };

  _handleTouchEnd = (e: Event) => {
    if (!isTouchEvent(e)) return;
    if (e.touches.length === 0) {
      this._touch.active = false;
      this._touch.pinchDist = 0;
      $pan.set(this._pan);
    } else if (e.touches.length === 1) {
      this._touch.active = true;
      this._touch.startX = e.touches[0].clientX;
      this._touch.startY = e.touches[0].clientY;
      this._touch.startPanX = this._pan.x;
      this._touch.startPanY = this._pan.y;
      this._touch.pinchDist = 0;
    }
  };

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
    }
  };

  _requestRender() {
    this._renderComponent();
  }

  _updateViewportTransform() {
    const viewport = this._shadow.querySelector(".viewport") as HTMLElement | null;
    if (viewport) {
      viewport.style.transform = `translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`;
    }
    const indicator = this._shadow.querySelector(".zoom-indicator");
    if (indicator) indicator.textContent = `${Math.round(this._zoom * 100)}%`;
  }

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
      content = html`<div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[13px] text-[var(--viz-error-text,#dc2626)] bg-[var(--viz-error-bg,#fef2f2)] px-4 py-3 rounded-md border border-[var(--viz-error-border,#fecaca)] max-w-[300px] text-center"
        role="alert"
      >
        ${err}
      </div>`;
    } else if (!layout) {
      content = html`<div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center font-mono text-[var(--viz-text-muted,#9ca3af)]"
      >
        <div class="mb-2 opacity-50">
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
        <div class="text-sm">No actor loaded</div>
      </div>`;
    } else {
      content = html`<div
          class="viewport absolute origin-[0_0] will-change-transform contain-layout"
          role="img"
          aria-label="State machine graph with ${layout.nodes.length} nodes and ${layout.edges
            .length} transitions"
          style="transform:translate(${pan.x}px,${pan.y}px) scale(${zoom})"
        >
          ${layout.edges.map((e) => {
            return html`<edge-path
              .edgeId=${e.id}
              .path=${e.path}
              .isActive=${e.isActive}
              .graphWidth=${layout.width}
              .graphHeight=${layout.height}
            ></edge-path>`;
          })}
          ${layout.nodes.map((n) => {
            return html`<state-node
              .nodeId=${n.id}
              .label=${n.label}
              .isActive=${n.isActive}
              .isFinal=${n.isFinal}
              .x=${n.x}
              .y=${n.y}
              .width=${n.width}
              .height=${n.height}
              .selected=${sel === n.id}
            ></state-node>`;
          })}
        </div>
        <div class="controls">
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
          </div>
          <button class="fit-btn" aria-label="Fit to view" @click=${() => zoomToFit()}>F</button>
          <button class="fit-btn" aria-label="Reset view" @click=${() => resetView()}>0</button>
        </div>`;
    }
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      html`${unsafeHTML(STYLES)}
        <div
          class="container w-full h-full overflow-hidden cursor-grab relative outline-none touch-none"
          id="graph-container"
          tabindex="0"
          role="application"
          aria-label="State machine graph. Use arrow keys to navigate nodes, plus and minus to zoom."
          @keydown=${this._handleKeyDown}
        >
          ${content}
        </div>`,
      this._shadow,
    );
    resolve!();
  }
}

import { unsafeHTML } from "lit/directives/unsafe-html.js";

customElements.define("actor-graph", ActorGraphComponent);
