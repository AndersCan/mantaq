import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { StoreController } from "@nanostores/lit";
import type { AnyActor } from "@mantaq/core";
import type { GraphNode } from "../graph.ts";
import type { ComputedEdge } from "../layout.ts";
import {
  $flatNodes,
  $edges,
  $graphDimensions,
  $zoom,
  $pan,
  $selectedNodeId,
  $layoutLoading,
  $layoutError,
  $actor,
  ZOOM_MIN,
  ZOOM_MAX,
} from "../stores/graph-store.ts";
import { renderEdge } from "./edge.ts";

@customElement("actor-graph")
export class ActorGraph extends LitElement {
  @property({ type: Array }) nodes: GraphNode[] = [];
  @property({ type: Array }) edges: ComputedEdge[] = [];
  @property({ type: Number }) graphWidth = 800;
  @property({ type: Number }) graphHeight = 600;
  @property({ type: Number }) zoom = 1;
  @property({ type: Object }) pan: { x: number; y: number } = { x: 0, y: 0 };
  @property({ type: String }) selectedNodeId: string | null = null;
  @property({ type: String }) error: string | null = null;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) useStores = false;

  #nodesCtrl?: StoreController<GraphNode[]>;
  #edgesCtrl?: StoreController<ComputedEdge[]>;
  #dimensionsCtrl?: StoreController<{ width: number; height: number }>;
  #zoomCtrl?: StoreController<number>;
  #panCtrl?: StoreController<{ x: number; y: number }>;
  #selectedNodeIdCtrl?: StoreController<string | null>;
  #loadingCtrl?: StoreController<boolean>;
  #errorCtrl?: StoreController<string | null>;
  #actorCtrl?: StoreController<AnyActor | null>;

  #isPanning = false;
  #lastMouse = { x: 0, y: 0 };
  #showHelp = false;

  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: #fafafa;
      border: 1px solid var(--viz-region-border);
      border-radius: 4px;
    }
    .container {
      position: relative;
      transform-origin: 0 0;
    }
    svg.edges {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }
    .edge-path {
      pointer-events: stroke;
      cursor: pointer;
    }
    .controls {
      position: absolute;
      bottom: 12px;
      right: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 10;
    }
    .controls button {
      width: 32px;
      height: 32px;
      border: 1px solid #ccc;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .controls button:hover {
      background: #f0f0f0;
    }
    .help-tooltip {
      position: absolute;
      bottom: 12px;
      left: 12px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      z-index: 10;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .help-tooltip kbd {
      display: inline-block;
      padding: 1px 4px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: #f5f5f5;
      font-family: monospace;
      font-size: 11px;
      min-width: 18px;
      text-align: center;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #999;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }
    .error-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #d32f2f;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      padding: 16px;
      text-align: center;
    }
    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.useStores) {
      this.#initStoreControllers();
    }
    this.addEventListener("wheel", this.#handleWheel, { passive: false });
    this.addEventListener("mousedown", this.#handleMouseDown);
    this.addEventListener("dblclick", this.#handleDoubleClick);
    window.addEventListener("mousemove", this.#handleMouseMove);
    window.addEventListener("mouseup", this.#handleMouseUp);
    window.addEventListener("keydown", this.#handleKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("wheel", this.#handleWheel);
    this.removeEventListener("mousedown", this.#handleMouseDown);
    this.removeEventListener("dblclick", this.#handleDoubleClick);
    window.removeEventListener("mousemove", this.#handleMouseMove);
    window.removeEventListener("mouseup", this.#handleMouseUp);
    window.removeEventListener("keydown", this.#handleKeyDown);
  }

  #initStoreControllers() {
    if (this.#nodesCtrl) return;

    this.#nodesCtrl = new StoreController(this, $flatNodes);
    this.#edgesCtrl = new StoreController(this, $edges);
    this.#dimensionsCtrl = new StoreController(this, $graphDimensions);
    this.#zoomCtrl = new StoreController(this, $zoom);
    this.#panCtrl = new StoreController(this, $pan);
    this.#selectedNodeIdCtrl = new StoreController(this, $selectedNodeId);
    this.#loadingCtrl = new StoreController(this, $layoutLoading);
    this.#errorCtrl = new StoreController(this, $layoutError);
    this.#actorCtrl = new StoreController(this, $actor);
  }

  #handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const currentZoom = this.#getZoom();
    const currentPan = this.#getPan();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom + delta));

    const rect = this.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scale = newZoom / currentZoom;
    this.pan = {
      x: mouseX - scale * (mouseX - currentPan.x),
      y: mouseY - scale * (mouseY - currentPan.y),
    };
    this.zoom = newZoom;
    this.#dispatchZoomChange();
  };

  #handleMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("state-node")) return;
    this.#isPanning = true;
    this.#lastMouse = { x: e.clientX, y: e.clientY };
    this.style.cursor = "grabbing";
  };

  #handleMouseMove = (e: MouseEvent) => {
    if (!this.#isPanning) return;
    const dx = e.clientX - this.#lastMouse.x;
    const dy = e.clientY - this.#lastMouse.y;
    this.pan = { x: this.pan.x + dx, y: this.pan.y + dy };
    this.#lastMouse = { x: e.clientX, y: e.clientY };
  };

  #handleMouseUp = () => {
    this.#isPanning = false;
    this.style.cursor = "";
  };

  #handleDoubleClick = () => {
    this.zoomToFit();
  };

  #handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case "+":
      case "=":
        this.zoomIn();
        break;
      case "-":
        this.zoomOut();
        break;
      case "0":
        this.resetView();
        break;
      case "f":
      case "F":
        this.zoomToFit();
        break;
    }
  };

  zoomIn = () => {
    this.zoom = Math.min(ZOOM_MAX, this.zoom + 0.2);
    this.#dispatchZoomChange();
  };

  zoomOut = () => {
    this.zoom = Math.max(ZOOM_MIN, this.zoom - 0.2);
    this.#dispatchZoomChange();
  };

  resetView = () => {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.#dispatchZoomChange();
  };

  zoomToFit = () => {
    const nodes = this.#getNodes();
    if (nodes.length === 0) return;
    const rect = this.getBoundingClientRect();
    const padding = 40;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      if (node.x != null && node.y != null) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + (node.width ?? 120));
        maxY = Math.max(maxY, node.y + (node.height ?? 60));
      }
    }

    if (minX === Infinity) return;

    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const availW = rect.width - padding * 2;
    const availH = rect.height - padding * 2;

    this.zoom = Math.min(availW / graphW, availH / graphH, ZOOM_MAX);
    this.pan = {
      x: padding + (availW - graphW * this.zoom) / 2 - minX * this.zoom,
      y: padding + (availH - graphH * this.zoom) / 2 - minY * this.zoom,
    };
    this.#dispatchZoomChange();
  };

  #dispatchZoomChange() {
    this.dispatchEvent(
      new CustomEvent("zoom-change", {
        detail: { zoom: this.zoom, pan: { ...this.pan } },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #handleNodeSelect(nodeId: string) {
    this.selectedNodeId = nodeId;
    this.dispatchEvent(
      new CustomEvent("node-select", {
        detail: { nodeId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #handleTransitionTrigger(nodeId: string, transitionId: string) {
    const actor = this.#actorCtrl?.value ?? $actor.get();
    if (!actor) return;

    const snapshot = actor.snapshot();
    const currentPath = snapshot.path;
    let currentNode = "";
    for (const segment of currentPath) {
      currentNode = currentNode ? `${currentNode}/${segment}` : segment;
    }

    if (currentNode === nodeId) {
      const eventObj = { id: transitionId } as Parameters<typeof actor.send>[0];
      actor.send(eventObj);
      this.dispatchEvent(
        new CustomEvent("transition-sent", {
          detail: { nodeId, transitionId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  #renderEdges() {
    const edges = this.#getEdges();
    const dims = this.#getDimensions();

    if (edges.length === 0) return svg``;

    return svg`
      <svg
        class="edges"
        width="${dims.width}"
        height="${dims.height}"
        viewBox="0 0 ${dims.width} ${dims.height}"
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="10"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 10 3.5, 0 7" style="fill: var(--viz-edge-stroke)" />
          </marker>
          <marker
            id="arrowhead-active"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="10"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 10 3.5, 0 7" style="fill: var(--viz-edge-active-stroke)" />
          </marker>
        </defs>
        ${edges.map((edge) => renderEdge(edge))}
      </svg>
    `;
  }

  #renderNodes() {
    const nodes = this.#getNodes();
    const selectedId = this.#getSelectedNodeId();
    const edges = this.#getEdges();

    return nodes.map((node) => {
      const nodeTransitions = edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => edge.label);

      return html`
        <state-node
          .nodeId=${node.id}
          .label=${node.label}
          .isActive=${node.isActive}
          .isFinal=${node.isFinal}
          .isSelected=${node.id === selectedId}
          .xPos=${node.x ?? 0}
          .yPos=${node.y ?? 0}
          .nodeWidth=${node.width ?? 120}
          .nodeHeight=${node.height ?? 60}
          .transitions=${nodeTransitions}
          @node-select=${(e: CustomEvent) => this.#handleNodeSelect(e.detail.nodeId)}
          @transition-trigger=${(e: CustomEvent) =>
            this.#handleTransitionTrigger(e.detail.nodeId, e.detail.transitionId)}
        ></state-node>
      `;
    });
  }

  #getNodes(): GraphNode[] {
    return this.#nodesCtrl?.value ?? this.nodes;
  }

  #getEdges(): ComputedEdge[] {
    return this.#edgesCtrl?.value ?? this.edges;
  }

  #getDimensions(): { width: number; height: number } {
    return this.#dimensionsCtrl?.value ?? { width: this.graphWidth, height: this.graphHeight };
  }

  #getZoom(): number {
    return this.#zoomCtrl?.value ?? this.zoom;
  }

  #getPan(): { x: number; y: number } {
    return this.#panCtrl?.value ?? this.pan;
  }

  #getSelectedNodeId(): string | null {
    return this.#selectedNodeIdCtrl?.value ?? this.selectedNodeId;
  }

  #getLoading(): boolean {
    return this.#loadingCtrl?.value ?? this.loading;
  }

  #getError(): string | null {
    return this.#errorCtrl?.value ?? this.error;
  }

  #toggleHelp() {
    this.#showHelp = !this.#showHelp;
    this.requestUpdate();
  }

  render() {
    const error = this.#getError();
    const loading = this.#getLoading();
    const nodes = this.#getNodes();

    if (error) {
      return html`<div class="error-state">${error}</div>`;
    }

    if (loading) {
      return html`<div class="loading-state">Loading...</div>`;
    }

    if (nodes.length === 0) {
      return html`<div class="empty-state">No graph data</div>`;
    }

    const zoom = this.#getZoom();
    const pan = this.#getPan();
    const dims = this.#getDimensions();

    return html`
      <div
        class="container"
        style="transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom}); width: ${dims.width}px; height: ${dims.height}px;"
      >
        ${this.#renderEdges()} ${this.#renderNodes()}
      </div>
      ${this.#showHelp
        ? html`
            <div class="help-tooltip">
              <div><kbd>+</kbd> / <kbd>=</kbd> Zoom in</div>
              <div><kbd>-</kbd> Zoom out</div>
              <div><kbd>0</kbd> Reset view</div>
              <div><kbd>F</kbd> Zoom to fit</div>
              <div>Scroll to zoom</div>
              <div>Drag to pan</div>
              <div>Double-click to fit</div>
            </div>
          `
        : ""}
      <div class="controls">
        <button @click=${this.zoomIn} title="Zoom in">+</button>
        <button @click=${this.zoomOut} title="Zoom out">−</button>
        <button @click=${this.resetView} title="Reset view">0</button>
        <button @click=${this.zoomToFit} title="Zoom to fit">⊞</button>
        <button @click=${() => this.#toggleHelp()} title="Keyboard shortcuts">?</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "actor-graph": ActorGraph;
  }
}
