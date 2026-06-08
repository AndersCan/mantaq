import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { GraphNode } from "../graph.ts";
import type { ComputedEdge } from "../layout.ts";
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

  #isPanning = false;
  #lastMouse = { x: 0, y: 0 };

  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: #fafafa;
      border: 1px solid #e0e0e0;
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
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #999;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
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

  #handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(5, this.zoom + delta));

    const rect = this.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scale = newZoom / this.zoom;
    this.pan = {
      x: mouseX - scale * (mouseX - this.pan.x),
      y: mouseY - scale * (mouseY - this.pan.y),
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
    this.zoom = Math.min(5, this.zoom + 0.2);
    this.#dispatchZoomChange();
  };

  zoomOut = () => {
    this.zoom = Math.max(0.1, this.zoom - 0.2);
    this.#dispatchZoomChange();
  };

  resetView = () => {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.#dispatchZoomChange();
  };

  zoomToFit = () => {
    if (this.nodes.length === 0) return;
    const rect = this.getBoundingClientRect();
    const padding = 40;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of this.nodes) {
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

    this.zoom = Math.min(availW / graphW, availH / graphH, 2);
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

  #renderEdges() {
    if (this.edges.length === 0) return svg``;

    return svg`
      <svg
        class="edges"
        width="${this.graphWidth}"
        height="${this.graphHeight}"
        viewBox="0 0 ${this.graphWidth} ${this.graphHeight}"
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
            <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
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
            <polygon points="0 0, 10 3.5, 0 7" fill="#4CAF50" />
          </marker>
        </defs>
        ${this.edges.map((edge) => renderEdge(edge))}
      </svg>
    `;
  }

  #renderNodes() {
    return this.nodes.map(
      (node) => html`
        <state-node
          .nodeId=${node.id}
          .label=${node.label}
          .isActive=${node.isActive}
          .isFinal=${node.isFinal}
          .isSelected=${node.id === this.selectedNodeId}
          .xPos=${node.x ?? 0}
          .yPos=${node.y ?? 0}
          .nodeWidth=${node.width ?? 120}
          .nodeHeight=${node.height ?? 60}
          @node-select=${(e: CustomEvent) => this.#handleNodeSelect(e.detail.nodeId)}
        ></state-node>
      `,
    );
  }

  render() {
    if (this.nodes.length === 0) {
      return html`<div class="empty-state">No graph data</div>`;
    }

    return html`
      <div
        class="container"
        style="transform: translate(${this.pan.x}px, ${this.pan.y}px) scale(${this
          .zoom}); width: ${this.graphWidth}px; height: ${this.graphHeight}px;"
      >
        ${this.#renderEdges()} ${this.#renderNodes()}
      </div>
      <div class="controls">
        <button @click=${this.zoomIn} title="Zoom in">+</button>
        <button @click=${this.zoomOut} title="Zoom out">−</button>
        <button @click=${this.resetView} title="Reset view">0</button>
        <button @click=${this.zoomToFit} title="Zoom to fit">⊞</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "actor-graph": ActorGraph;
  }
}
