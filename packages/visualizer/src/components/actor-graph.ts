import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  $zoom,
  $pan,
  $selectedNodeId,
  $layout,
  $isComputing,
  $layoutError,
  selectNode,
  zoomIn,
  zoomOut,
  zoomToFit,
  resetView,
  setZoom,
  setPan,
} from "../stores/graph-store.ts";
import type { LayoutResult } from "../layout.ts";

@customElement("actor-graph")
export class ActorGraphComponent extends LitElement {
  @property({ type: Number }) declare zoom: number;
  @property({ type: Object }) declare pan: { x: number; y: number };
  @property({ type: Object }) declare layout: LayoutResult | null;
  @property({ type: Boolean }) declare computing: boolean;
  @property({ type: String }) declare layoutError: string | null;
  @property({ type: String }) declare selectedNodeId: string | null;

  static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 400px;
      overflow: hidden;
      background: var(--viz-bg, #fafafa);
      border-radius: 8px;
      border: 1px solid var(--viz-border, #e5e7eb);
    }

    .container {
      width: 100%;
      height: 100%;
      overflow: hidden;
      cursor: grab;
      position: relative;
      outline: none;
    }

    .container:focus-visible {
      box-shadow: inset 0 0 0 2px var(--viz-accent, #3b82f6);
    }

    .container:active {
      cursor: grabbing;
    }

    .viewport {
      position: absolute;
      transform-origin: 0 0;
      will-change: transform;
    }

    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: monospace;
      font-size: 14px;
      color: var(--viz-text-muted, #6b7280);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .loading-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--viz-border);
      border-top-color: var(--viz-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .error {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: monospace;
      font-size: 13px;
      color: var(--viz-error-text, #dc2626);
      background: var(--viz-error-bg, #fef2f2);
      padding: 12px 16px;
      border-radius: 6px;
      border: 1px solid var(--viz-error-border, #fecaca);
      max-width: 300px;
      text-align: center;
    }

    .zoom-controls {
      position: absolute;
      bottom: 12px;
      right: 12px;
      display: flex;
      gap: 4px;
      background: var(--viz-node-bg);
      border: 1px solid var(--viz-border);
      border-radius: 6px;
      padding: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .zoom-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 4px;
      font-size: 14px;
      color: var(--viz-node-label);
      transition: background 0.15s;
    }

    .zoom-btn:hover {
      background: var(--viz-border);
    }

    .zoom-indicator {
      font-family: monospace;
      font-size: 11px;
      color: var(--viz-text-muted, #6b7280);
      display: flex;
      align-items: center;
      padding: 0 6px;
      min-width: 40px;
      justify-content: center;
    }

    .help-overlay {
      position: absolute;
      top: 12px;
      right: 12px;
      background: var(--viz-node-bg);
      border: 1px solid var(--viz-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 11px;
      color: var(--viz-text-muted);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      display: flex;
      gap: 10px;
      max-width: calc(100% - 24px);
    }

    .help-overlay kbd {
      background: var(--viz-border);
      border: 1px solid var(--viz-node-border);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 10px;
    }

    .empty-state {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      font-family: monospace;
      color: var(--viz-text-muted, #9ca3af);
    }

    .empty-state-icon {
      margin-bottom: 8px;
      opacity: 0.5;
    }

    .empty-state-text {
      font-size: 14px;
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-spinner {
        animation: none;
      }
    }

    @media (max-width: 480px) {
      .help-overlay {
        display: none;
      }
    }
  `;

  constructor() {
    super();
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.layout = null;
    this.computing = false;
    this.layoutError = null;
    this.selectedNodeId = null;
    this.#isPanning = false;
    this.#panStart = { x: 0, y: 0 };
    this.#unsubscribers = [];
    this.#boundHandlers = [];
  }

  #isPanning: boolean;
  #panStart: { x: number; y: number };
  #unsubscribers: Array<() => void>;
  #boundHandlers: Array<[EventTarget, string, EventListener]>;

  connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribers.push(
      $zoom.subscribe((v) => (this.zoom = v)),
      $pan.subscribe((v) => (this.pan = v)),
      $layout.subscribe((v) => (this.layout = v)),
      $isComputing.subscribe((v) => (this.computing = v)),
      $layoutError.subscribe((v) => (this.layoutError = v)),
      $selectedNodeId.subscribe((v) => (this.selectedNodeId = v)),
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const [target, event, handler] of this.#boundHandlers) {
      target.removeEventListener(event, handler);
    }
    this.#boundHandlers = [];
    for (const unsub of this.#unsubscribers) unsub();
  }

  firstUpdated(): void {
    const container = this.shadowRoot?.querySelector(".container");
    if (!container) return;

    const add = (
      target: EventTarget,
      event: string,
      fn: (e: Event) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(event, fn as EventListener, opts);
      this.#boundHandlers.push([target, event, fn as EventListener]);
    };

    add(container, "wheel", this.#handleWheel, { passive: false });
    add(container, "mousedown", this.#handleMouseDown);
    add(container, "dblclick", this.#handleDblClick);
    add(container, "node-select", this.#handleNodeSelect);
    add(window, "mousemove", this.#handleMouseMove);
    add(window, "mouseup", this.#handleMouseUp);
  }

  #handleWheel = (e: Event): void => {
    const wheelEvent = e as WheelEvent;
    wheelEvent.preventDefault();
    const rect = (wheelEvent.currentTarget as HTMLElement).getBoundingClientRect();
    const cursorX = wheelEvent.clientX - rect.left;
    const cursorY = wheelEvent.clientY - rect.top;

    const oldZoom = this.zoom;
    const delta = wheelEvent.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const newZoom = Math.min(Math.max(oldZoom + delta, MIN_ZOOM), MAX_ZOOM);
    const scale = newZoom / oldZoom;

    setZoom(newZoom);
    setPan({
      x: cursorX - (cursorX - this.pan.x) * scale,
      y: cursorY - (cursorY - this.pan.y) * scale,
    });
  };

  #handleMouseDown = (e: Event): void => {
    const mouseEvent = e as MouseEvent;
    if ((mouseEvent.target as HTMLElement).closest("state-node")) return;
    this.#isPanning = true;
    this.#panStart = { x: mouseEvent.clientX - this.pan.x, y: mouseEvent.clientY - this.pan.y };
  };

  #handleMouseMove = (e: Event): void => {
    if (!this.#isPanning) return;
    const mouseEvent = e as MouseEvent;
    setPan({
      x: mouseEvent.clientX - this.#panStart.x,
      y: mouseEvent.clientY - this.#panStart.y,
    });
  };

  #handleMouseUp = (): void => {
    this.#isPanning = false;
  };

  #handleDblClick = (e: Event): void => {
    const mouseEvent = e as MouseEvent;
    const rect = (mouseEvent.currentTarget as HTMLElement).getBoundingClientRect();
    const cursorX = mouseEvent.clientX - rect.left;
    const cursorY = mouseEvent.clientY - rect.top;

    const oldZoom = this.zoom;
    const newZoom = Math.min(oldZoom + ZOOM_STEP * 2, MAX_ZOOM);
    const scale = newZoom / oldZoom;

    setZoom(newZoom);
    setPan({
      x: cursorX - (cursorX - this.pan.x) * scale,
      y: cursorY - (cursorY - this.pan.y) * scale,
    });
  };

  #handleNodeSelect = (e: Event): void => {
    const detail = (e as CustomEvent).detail;
    selectNode(detail.nodeId);
  };

  #panToNode(nodeId: string): void {
    const nodes = this.layout?.nodes;
    if (!nodes) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const container = this.shadowRoot?.querySelector(".container");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nodeCenterX = node.x + node.width / 2;
    const nodeCenterY = node.y + node.height / 2;
    setPan({
      x: rect.width / 2 - nodeCenterX * this.zoom,
      y: rect.height / 2 - nodeCenterY * this.zoom,
    });
  }

  #handleKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case "+":
      case "=":
        zoomIn();
        break;
      case "-":
        zoomOut();
        break;
      case "0":
        resetView();
        break;
      case "f":
      case "F":
        zoomToFit();
        break;
      case "Escape":
        selectNode(null);
        break;
      case "ArrowRight":
      case "ArrowDown": {
        e.preventDefault();
        const nodes = this.layout?.nodes;
        if (!nodes?.length) break;
        const currentIdx = nodes.findIndex((n) => n.id === this.selectedNodeId);
        const nextIdx = currentIdx < nodes.length - 1 ? currentIdx + 1 : 0;
        const nextId = nodes[nextIdx].id;
        selectNode(nextId);
        this.#panToNode(nextId);
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        e.preventDefault();
        const nodes = this.layout?.nodes;
        if (!nodes?.length) break;
        const currentIdx = nodes.findIndex((n) => n.id === this.selectedNodeId);
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : nodes.length - 1;
        const prevId = nodes[prevIdx].id;
        selectNode(prevId);
        this.#panToNode(prevId);
        break;
      }
    }
  };

  render() {
    if (this.computing) {
      return html`
        <div class="loading" role="status" aria-live="polite">
          <div class="loading-spinner" aria-hidden="true"></div>
          Computing layout...
        </div>
      `;
    }

    if (this.layoutError) {
      return html`<div class="error" role="alert">${this.layoutError}</div>`;
    }

    if (!this.layout) {
      return html`
        <div class="empty-state">
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
        </div>
      `;
    }

    const transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;

    return html`
      <div class="container" tabindex="0" @keydown=${this.#handleKeyDown}>
        <div class="viewport" style="transform: ${transform}">
          ${this.layout.edges.map(
            (edge) => html`
              <edge-path
                .edgeId=${edge.id}
                .path=${edge.path}
                .label=${edge.label}
                .isActive=${edge.isActive}
                .labelX=${edge.labelX}
                .labelY=${edge.labelY}
              ></edge-path>
            `,
          )}
          ${this.layout.nodes.map(
            (node) => html`
              <state-node
                .nodeId=${node.id}
                .label=${node.label}
                .isActive=${node.isActive}
                .isFinal=${node.isFinal}
                .x=${node.x}
                .y=${node.y}
                .width=${node.width}
                .height=${node.height}
                .selected=${this.selectedNodeId === node.id}
              ></state-node>
            `,
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
          <button class="zoom-btn" aria-label="Zoom out" @click=${() => zoomOut()}>&minus;</button>
          <span class="zoom-indicator" aria-live="polite" aria-label="Zoom level"
            >${Math.round(this.zoom * 100)}%</span
          >
          <button class="zoom-btn" aria-label="Zoom in" @click=${() => zoomIn()}>+</button>
        </div>
      </div>
    `;
  }
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.2;

declare global {
  interface HTMLElementTagNameMap {
    "actor-graph": ActorGraphComponent;
  }
}
