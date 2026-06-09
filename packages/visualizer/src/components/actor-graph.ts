import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  $zoom,
  $pan,
  $selectedNodeId,
  $layout,
  $layoutError,
  $contextData,
  $searchQuery,
  $searchResults,
  $filterStatus,
  $lastTransition,
  $layoutAnimation,
  getVisibleNodes,
  zoomToFit,
  resetView,
  setZoom,
  selectAllNodes,
  deselectAllNodes,
} from "../graph-store.ts";
import { $minimapVisible } from "./minimap.ts";
import { $exportMenuVisible } from "../export.ts";
import { $shortcutOverlayVisible } from "./shortcut-overlay.ts";
import { openGoToDialog } from "./go-to-dialog.ts";
import { openShortcutEditor } from "./shortcut-editor.ts";
import "./search-bar.ts";
import "./filter-controls.ts";
import "./node-details-panel.ts";
import "./layout-controls.ts";
import "./export-menu.ts";
import "./shortcut-overlay.ts";
import "./go-to-dialog.ts";
import "./shortcut-editor.ts";
import type { LayoutResult } from "../layout.ts";
import type { NodeSelectDetail } from "../types.ts";
import { isWheelEvent, isMouseEvent, isTouchEvent, isCustomEvent } from "../types.ts";

const ZOOM_STEP = 0.2;

const STYLES = `<style>
  :host { display: block; position: relative; width: 100%; height: 100%; min-height: 300px; overflow: hidden; background: var(--viz-bg, #fafafa); border-radius: 8px; border: 1px solid var(--viz-border, #e5e7eb); transition: background-color 0.3s ease, border-color 0.3s ease; }
  .container:focus-visible { box-shadow: inset 0 0 0 2px var(--viz-accent, #3b82f6); }
  .container:active { cursor: grabbing; }
  .viewport.animate { transition: transform 0.3s ease; }
  .zoom-btn:hover { background: var(--viz-border); }
  .help-overlay kbd { background: var(--viz-border); border: 1px solid var(--viz-node-border); border-radius: 3px; padding: 0 4px; font-size: 10px; }
  .minimap-toggle:hover { background: var(--viz-border); }
  .minimap-toggle.active { background: var(--viz-accent, #6366f1); color: #fff; border-color: var(--viz-accent, #6366f1); }
  .export-toggle:hover { background: var(--viz-border); }
  .export-toggle.active { background: var(--viz-accent, #6366f1); color: #fff; border-color: var(--viz-accent, #6366f1); }
  .history-toggle { position: absolute; bottom: 12px; right: 80px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: none; background: var(--viz-node-bg); cursor: pointer; border-radius: 4px; font-size: 12px; color: var(--viz-node-label); border: 1px solid var(--viz-border); transition: background .15s; box-shadow: 0 1px 3px rgba(0,0,0,.08); z-index: 10; }
  .history-toggle:hover { background: var(--viz-border); }
  .history-toggle.active { background: var(--viz-accent, #6366f1); color: #fff; border-color: var(--viz-accent, #6366f1); }
  .history-badge { position: absolute; top: -4px; right: -4px; min-width: 14px; height: 14px; border-radius: 7px; background: var(--viz-accent, #6366f1); color: #fff; font-size: 9px; font-family: monospace; display: flex; align-items: center; justify-content: center; padding: 0 3px; pointer-events: none; }
  .history-panel-wrapper { position: absolute; bottom: 48px; right: 12px; z-index: 20; }
  .mobile-btn:active { background: var(--viz-border); }
  .toolbar > * { pointer-events: auto; }
  search-bar { flex: 1; max-width: 240px; }
  filter-controls { flex-shrink: 0; }
  layout-controls { flex-shrink: 0; }
  .mobile-fit-btn, .mobile-reset-btn, .mobile-minimap-btn { font-size: 14px; }
  @media (max-width: 768px) {
    :host { min-height: 250px; }
    .help-overlay { display: none; }
    .zoom-controls { display: none; }
    .minimap-toggle { display: none; }
    .mobile-toolbar { display: block; }
    .error { max-width: 240px; font-size: 12px; padding: 10px 12px; }
    .empty-state-text { font-size: 13px; }
  }
  @media (max-width: 480px) {
    :host { min-height: 200px; border-radius: 0; border: none; }
    .mobile-toolbar { bottom: 8px; left: 8px; right: 8px; padding: 4px; }
    .mobile-btn { width: 40px; height: 40px; font-size: 16px; }
    .mobile-zoom-label { font-size: 12px; min-width: 40px; }
  }
  @media (max-height: 500px) and (orientation: landscape) {
    :host { min-height: 150px; }
    .mobile-toolbar { bottom: 4px; left: 4px; right: 4px; padding: 2px; }
    .mobile-btn { width: 36px; height: 36px; font-size: 14px; }
  }
  @media (max-width: 768px) {
    .toolbar { top: 8px; left: 8px; right: 8px; gap: 4px; }
    search-bar { max-width: 160px; }
  }
  @media (prefers-reduced-motion: reduce) { .viewport { will-change: auto; } }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .skip-link { position: absolute; top: -40px; left: 0; background: var(--viz-accent, #6366f1); color: #fff; padding: 8px 16px; z-index: 100; font-family: monospace; font-size: 13px; text-decoration: none; border-radius: 0 0 6px 0; transition: top .15s; }
  .skip-link:focus { top: 0; }
</style>`;

export class ActorGraphComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _drag: { active: boolean; sx: number; sy: number } = { active: false, sx: 0, sy: 0 };
  _touch: {
    active: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    pinchDist: number;
    pinchZoom: number;
    pinchCenterX: number;
    pinchCenterY: number;
    lastTapTime: number;
    tapCount: number;
    tapTimer: ReturnType<typeof setTimeout> | null;
  } = {
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    pinchDist: 0,
    pinchZoom: 1,
    pinchCenterX: 0,
    pinchCenterY: 0,
    lastTapTime: 0,
    tapCount: 0,
    tapTimer: null,
  };
  _unsubscribers: Array<() => void> = [];
  _abort: AbortController | null = null;
  _zoom = 1;
  _pan = { x: 0, y: 0 };
  _layout: LayoutResult | null = null;
  _layoutError: string | null = null;
  _selectedNodeId: string | null = null;
  _contextData: Record<string, unknown> = {};
  _minimapVisible = false;
  _searchQuery = "";
  _searchResults: string[] = [];
  _filterStatus = "all";
  _layoutAnimation = true;
  _lastTransition: {
    activatedNodes?: string[];
    deactivatedNodes?: string[];
    activatedEdges?: string[];
  } | null = null;
  _previousNodeIds: Set<string> = new Set();
  _srTransitionAnnouncement = "";
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
        if (v) {
          this._previousNodeIds = new Set(v.nodes.map((n) => n.id));
        }
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
      $contextData.subscribe((v) => {
        this._contextData = v;
        this._requestRender();
      }),
      $minimapVisible.subscribe((v) => {
        this._minimapVisible = v;
        this._requestRender();
      }),
      $searchQuery.subscribe((v) => {
        this._searchQuery = v;
        this._requestRender();
      }),
      $searchResults.subscribe((v) => {
        this._searchResults = [...v];
        this._requestRender();
      }),
      $filterStatus.subscribe((v) => {
        this._filterStatus = v;
        this._requestRender();
      }),
      $layoutAnimation.subscribe((v) => {
        this._layoutAnimation = v;
        this._requestRender();
      }),
      $lastTransition.subscribe((v) => {
        this._lastTransition = v;
        if (v) {
          this._srTransitionAnnouncement = this._buildTransitionAnnouncement(v);
        }
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
      el.addEventListener("dblclick", this._handleDblClick, { signal: s });
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

  _handleDblClick = (e: Event) => {
    if (!isMouseEvent(e)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, this._zoom + ZOOM_STEP * 2);
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
      const now = Date.now();
      if (now - this._touch.lastTapTime < 300) {
        this._touch.tapCount++;
        if (this._touch.tapCount >= 2) {
          if (this._touch.tapTimer) clearTimeout(this._touch.tapTimer);
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          this._zoomAtPoint(
            touches[0].clientX - rect.left,
            touches[0].clientY - rect.top,
            this._zoom + ZOOM_STEP * 2,
          );
          this._touch.tapCount = 0;
          this._touch.lastTapTime = 0;
          return;
        }
      } else {
        this._touch.tapCount = 1;
      }
      this._touch.lastTapTime = now;
      this._touch.tapTimer = setTimeout(() => {
        this._touch.tapCount = 0;
      }, 300);

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
      if (this._touch.active && e.changedTouches.length > 0) {
        const dx = e.changedTouches[0].clientX - this._touch.startX;
        const dy = e.changedTouches[0].clientY - this._touch.startY;
        const SWIPE_THRESHOLD = 80;
        const SWIPE_MAX_VERTICAL = 60;
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_MAX_VERTICAL) {
          this._navigateNode(dx > 0 ? -1 : 1);
        }
      }
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

  _focusSearch() {
    const searchBar = this._shadow.querySelector("search-bar") as HTMLElement & {
      focusInput?: () => void;
    };
    searchBar?.focusInput?.();
  }

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

  _navigateToFirst() {
    const nodes = this._layout?.nodes;
    if (!nodes?.length) return;
    const firstId = nodes[0].id;
    $selectedNodeId.set(firstId);
    this._panToNode(firstId);
  }

  _navigateToLast() {
    const nodes = this._layout?.nodes;
    if (!nodes?.length) return;
    const lastId = nodes[nodes.length - 1].id;
    $selectedNodeId.set(lastId);
    this._panToNode(lastId);
  }

  _handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      this._focusSearch();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      $exportMenuVisible.set(!$exportMenuVisible.get());
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "g") {
      e.preventDefault();
      openGoToDialog();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      selectAllNodes();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      deselectAllNodes();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      openShortcutEditor();
      return;
    }
    if (
      e.key === "/" &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      this._focusSearch();
      return;
    }
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
      case "m":
      case "M":
        $minimapVisible.set(!$minimapVisible.get());
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
      case "Home":
        e.preventDefault();
        this._navigateToFirst();
        break;
      case "End":
        e.preventDefault();
        this._navigateToLast();
        break;
      case "?":
        $shortcutOverlayVisible.set(!$shortcutOverlayVisible.get());
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          this._focusPrev();
        } else {
          this._focusNext();
        }
        break;
    }
  };

  _getInteractiveElements(): HTMLElement[] {
    const selectors = [
      "search-bar",
      "filter-controls",
      "layout-controls",
      ".minimap-toggle",
      ".export-toggle",
      ".history-toggle",
      ".zoom-btn",
      "state-node",
    ];
    const elements: HTMLElement[] = [];
    for (const sel of selectors) {
      const found = this._shadow.querySelectorAll(sel);
      for (const el of found) {
        elements.push(el as HTMLElement);
      }
    }
    return elements;
  }

  _focusNext() {
    const elements = this._getInteractiveElements();
    if (elements.length === 0) return;
    const active = this._shadow.activeElement;
    const idx = elements.indexOf(active as HTMLElement);
    const next = elements[(idx + 1) % elements.length];
    next.focus();
  }

  _focusPrev() {
    const elements = this._getInteractiveElements();
    if (elements.length === 0) return;
    const active = this._shadow.activeElement;
    const idx = elements.indexOf(active as HTMLElement);
    const prev = elements[(idx - 1 + elements.length) % elements.length];
    prev.focus();
  }

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
    const mobileIndicator = this._shadow.querySelector(".mobile-zoom-label");
    if (mobileIndicator) mobileIndicator.textContent = `${Math.round(this._zoom * 100)}%`;
  }

  _updateMinimapSize() {
    if (!this._minimapVisible) return;
    const minimap = this._shadow.querySelector("minimap-component") as HTMLElement & {
      setContainerSize?: (w: number, h: number) => void;
    };
    if (!minimap?.setContainerSize) return;
    const container = this._shadow.querySelector(".container");
    if (!container) return;
    const r = container.getBoundingClientRect();
    if (r.width && r.height) minimap.setContainerSize(r.width, r.height);
  }

  _buildTransitionAnnouncement(t: {
    activatedNodes?: string[];
    deactivatedNodes?: string[];
    activatedEdges?: string[];
  }): string {
    const parts: string[] = [];
    if (t.activatedNodes?.length) {
      const names = t.activatedNodes.map((id) => {
        const n = this._layout?.nodes.find((nd) => nd.id === id);
        return n?.label ?? id;
      });
      parts.push(`Activated: ${names.join(", ")}`);
    }
    if (t.deactivatedNodes?.length) {
      const names = t.deactivatedNodes.map((id) => {
        const n = this._layout?.nodes.find((nd) => nd.id === id);
        return n?.label ?? id;
      });
      parts.push(`Deactivated: ${names.join(", ")}`);
    }
    return parts.join(". ");
  }

  _srAnnouncement(): string {
    if (this._layoutError) return `Error: ${this._layoutError}`;
    if (!this._layout) return "No actor loaded";
    const parts: string[] = [];
    const sel = this._selectedNodeId;
    if (sel) {
      const node = this._layout.nodes.find((n) => n.id === sel);
      if (node)
        parts.push(
          `Selected node: ${node.label}${node.isActive ? ", active" : ""}${node.isFinal ? ", final" : ""}`,
        );
    }
    if (this._srTransitionAnnouncement) {
      parts.push(this._srTransitionAnnouncement);
      this._srTransitionAnnouncement = "";
    }
    return parts.join(". ");
  }

  _renderComponent() {
    const {
      _layoutError: err,
      _layout: layout,
      _pan: pan,
      _zoom: zoom,
      _selectedNodeId: sel,
      _minimapVisible: minimapVis,
    } = this;
    let content;
    if (err) {
      content = html`<div
        class="error absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[13px] text-[var(--viz-error-text,#dc2626)] bg-[var(--viz-error-bg,#fef2f2)] px-4 py-3 rounded-md border border-[var(--viz-error-border,#fecaca)] max-w-[300px] text-center"
        role="alert"
        aria-live="assertive"
      >
        ${err}
      </div>`;
    } else if (!layout) {
      content = html`<div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center font-mono text-[var(--viz-text-muted,#9ca3af)] empty-state"
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
        <div class="empty-state-text text-sm">No actor loaded</div>
      </div>`;
    } else {
      const searchSet = this._searchQuery.trim() ? new Set(this._searchResults) : null;
      content = html` <div
          class="viewport absolute origin-[0_0] will-change-transform contain-layout${this
            ._layoutAnimation
            ? " animate"
            : ""}"
          role="img"
          aria-label="State machine graph with ${layout.nodes.length} nodes and ${layout.edges
            .length} transitions"
          style="transform:translate(${pan.x}px,${pan.y}px) scale(${zoom})"
        >
          ${layout.edges.map((e) => {
            const animClass = this._lastTransition?.activatedEdges?.includes(e.id)
              ? "traversal"
              : "";
            return html`<edge-path
              .edgeId=${e.id}
              .path=${e.path}
              .label=${e.label}
              .isActive=${e.isActive}
              .labelX=${e.labelX}
              .labelY=${e.labelY}
              .graphWidth=${layout.width}
              .graphHeight=${layout.height}
              .animationClass=${animClass}
            ></edge-path>`;
          })}
          ${layout.nodes.map((n) => {
            const isMatch = searchSet?.has(n.id) ?? false;
            const visibleNodes = getVisibleNodes();
            const isDimmed = visibleNodes !== null && !visibleNodes.has(n.id);
            const isNew = !this._previousNodeIds.has(n.id);
            const animClass = this._lastTransition?.activatedNodes?.includes(n.id)
              ? "node-activate"
              : this._lastTransition?.deactivatedNodes?.includes(n.id)
                ? "node-deactivate"
                : isNew
                  ? "node-enter"
                  : "";
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
              .contextData=${sel === n.id ? (this._contextData[n.id] ?? null) : null}
              .searchMatch=${isMatch}
              .animationClass=${animClass}
              class=${isDimmed ? "dimmed" : ""}
            ></state-node>`;
          })}
        </div>
        ${minimapVis
          ? html`<div class="absolute top-3 left-3 z-10">
              <minimap-component></minimap-component>
            </div>`
          : ""}
        <div
          class="toolbar absolute top-3 left-3 right-3 flex gap-2 items-center z-[15] pointer-events-none"
        >
          <search-bar></search-bar>
          <filter-controls></filter-controls>
          <layout-controls></layout-controls>
        </div>
        <div
          class="help-overlay absolute top-3 right-3 bg-[var(--viz-node-bg)] border border-[var(--viz-border)] rounded-md px-3 py-2 font-mono text-[11px] text-[var(--viz-text-muted)] shadow-sm flex gap-2.5 max-w-[calc(100%-24px)]"
        >
          <span><kbd>+</kbd>/<kbd>-</kbd> zoom</span>
          <span><kbd>0</kbd> reset</span>
          <span><kbd>F</kbd> fit</span>
          <span><kbd>M</kbd> minimap</span>
          <span><kbd>E</kbd> export</span>
          <span><kbd>Ctrl+E</kbd> export menu</span>
          <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> navigate</span>
          <span><kbd>Esc</kbd> deselect</span>
        </div>
        <div
          class="absolute bottom-3 left-3 flex gap-1 bg-[var(--viz-node-bg)] border border-[var(--viz-border)] rounded-md p-1 shadow-sm zoom-controls"
        >
          <button
            class="zoom-btn w-7 h-7 flex items-center justify-center border-none bg-transparent cursor-pointer rounded text-sm text-[var(--viz-node-label)] transition-colors duration-150"
            aria-label="Zoom out"
            @click=${() => setZoom(this._zoom - ZOOM_STEP)}
          >
            &minus;
          </button>
          <span
            class="font-mono text-[11px] text-[var(--viz-text-muted,#6b7280)] flex items-center px-1.5 py-0 min-w-[40px] justify-center zoom-indicator"
            aria-live="polite"
            >${Math.round(zoom * 100)}%</span
          >
          <button
            class="zoom-btn w-7 h-7 flex items-center justify-center border-none bg-transparent cursor-pointer rounded text-sm text-[var(--viz-node-label)] transition-colors duration-150"
            aria-label="Zoom in"
            @click=${() => setZoom(this._zoom + ZOOM_STEP)}
          >
            +
          </button>
        </div>
        <button
          class="minimap-toggle absolute bottom-3 right-[48px] w-7 h-7 flex items-center justify-center border-none bg-[var(--viz-node-bg)] cursor-pointer rounded text-xs text-[var(--viz-node-label)] border border-[var(--viz-border)] transition-colors duration-150 shadow-sm z-10${minimapVis
            ? " active"
            : ""}"
          aria-label="Toggle minimap"
          aria-pressed="${minimapVis}"
          @click=${() => $minimapVisible.set(!$minimapVisible.get())}
        >
          M
        </button>
        <button
          class="export-toggle absolute bottom-3 right-[112px] w-7 h-7 flex items-center justify-center border-none bg-[var(--viz-node-bg)] cursor-pointer rounded text-xs text-[var(--viz-node-label)] border border-[var(--viz-border)] transition-colors duration-150 shadow-sm z-10"
          aria-label="Export graph"
          @click=${() => $exportMenuVisible.set(!$exportMenuVisible.get())}
        >
          E
        </button>
        <div class="absolute bottom-12 right-[112px] z-20"><export-menu></export-menu></div>
        <div
          class="mobile-toolbar hidden absolute bottom-3 left-3 right-3 bg-[var(--viz-node-bg)] border border-[var(--viz-border)] rounded-lg p-1.5 shadow-[0_2px_8px_rgba(0,0,0,.12)] z-20"
        >
          <div class="flex items-center justify-between gap-1">
            <div class="flex items-center gap-1">
              <button
                class="mobile-btn w-11 h-11 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-md text-lg text-[var(--viz-node-label)] transition-colors duration-150 [-webkit-tap-highlight-color:transparent]"
                aria-label="Zoom out"
                @click=${() => setZoom(this._zoom - ZOOM_STEP)}
              >
                &minus;
              </button>
              <span
                class="mobile-zoom-label font-mono text-[13px] text-[var(--viz-text-muted)] min-w-[48px] text-center"
                aria-live="polite"
                >${Math.round(zoom * 100)}%</span
              >
              <button
                class="mobile-btn w-11 h-11 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-md text-lg text-[var(--viz-node-label)] transition-colors duration-150 [-webkit-tap-highlight-color:transparent]"
                aria-label="Zoom in"
                @click=${() => setZoom(this._zoom + ZOOM_STEP)}
              >
                +
              </button>
            </div>
            <div class="flex items-center gap-1">
              <button
                class="mobile-btn w-11 h-11 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-md text-lg text-[var(--viz-node-label)] transition-colors duration-150 [-webkit-tap-highlight-color:transparent] mobile-fit-btn"
                aria-label="Fit to view"
                @click=${() => zoomToFit()}
              >
                F
              </button>
              <button
                class="mobile-btn w-11 h-11 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-md text-lg text-[var(--viz-node-label)] transition-colors duration-150 [-webkit-tap-highlight-color:transparent] mobile-reset-btn"
                aria-label="Reset view"
                @click=${() => resetView()}
              >
                0
              </button>
              <button
                class="mobile-btn w-11 h-11 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-md text-lg text-[var(--viz-node-label)] transition-colors duration-150 [-webkit-tap-highlight-color:transparent] mobile-minimap-btn${minimapVis
                  ? " active"
                  : ""}"
                aria-label="Toggle minimap"
                aria-pressed="${minimapVis}"
                @click=${() => $minimapVisible.set(!$minimapVisible.get())}
              >
                M
              </button>
            </div>
          </div>
        </div>
        <node-details-panel></node-details-panel>
        <shortcut-overlay></shortcut-overlay>
        <go-to-dialog></go-to-dialog>
        <shortcut-editor></shortcut-editor>
        <div class="sr-only" aria-live="polite" role="status">${this._srAnnouncement()}</div>`;
    }
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      html`${unsafeHTML(STYLES)}
        <a
          class="skip-link"
          href="#graph-container"
          @click=${(e: Event) => {
            e.preventDefault();
            (this._shadow.querySelector(".container") as HTMLElement)?.focus();
          }}
          >Skip to graph</a
        >
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
    if (minimapVis) requestAnimationFrame(() => this._updateMinimapSize());
    resolve!();
  }
}

customElements.define("actor-graph", ActorGraphComponent);
