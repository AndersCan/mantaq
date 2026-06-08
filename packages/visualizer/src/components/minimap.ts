import { LitElement, html, css } from "lit";
import { customElement, query } from "lit/decorators.js";
import { StoreController } from "@nanostores/lit";
import type { GraphNode } from "../graph.ts";
import { $flatNodes, $graphDimensions, $zoom, $pan, $viewport } from "../stores/graph-store.ts";

@customElement("minimap")
export class Minimap extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 150px;
      height: 100px;
      background: #fafafa;
      border: 1px solid var(--viz-region-border, #ccc);
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      z-index: 10;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  @query("canvas") accessor _canvas!: HTMLCanvasElement | null;

  #nodesCtrl?: StoreController<GraphNode[]>;
  #dimensionsCtrl?: StoreController<{ width: number; height: number }>;
  #zoomCtrl?: StoreController<number>;
  #panCtrl?: StoreController<{ x: number; y: number }>;
  #viewportCtrl?: StoreController<{ width: number; height: number }>;

  connectedCallback() {
    super.connectedCallback();
    this.#nodesCtrl = new StoreController(this, $flatNodes);
    this.#dimensionsCtrl = new StoreController(this, $graphDimensions);
    this.#zoomCtrl = new StoreController(this, $zoom);
    this.#panCtrl = new StoreController(this, $pan);
    this.#viewportCtrl = new StoreController(this, $viewport);
    this.addEventListener("click", this.#handleClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("click", this.#handleClick);
  }

  #getNodes(): GraphNode[] {
    return this.#nodesCtrl?.value ?? [];
  }

  #getDimensions(): { width: number; height: number } {
    return this.#dimensionsCtrl?.value ?? { width: 800, height: 600 };
  }

  #getZoom(): number {
    return this.#zoomCtrl?.value ?? 1;
  }

  #getPan(): { x: number; y: number } {
    return this.#panCtrl?.value ?? { x: 0, y: 0 };
  }

  #getViewport(): { width: number; height: number } {
    return this.#viewportCtrl?.value ?? { width: 800, height: 600 };
  }

  #handleClick = (e: MouseEvent) => {
    const canvas = this._canvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const dims = this.#getDimensions();
    const viewport = this.#getViewport();
    const scale = Math.min(150 / dims.width, 100 / dims.height);

    const graphX = clickX / scale;
    const graphY = clickY / scale;

    const newPanX = -graphX * this.#getZoom() + viewport.width / 2;
    const newPanY = -graphY * this.#getZoom() + viewport.height / 2;

    $pan.set({ x: newPanX, y: newPanY });
  };

  updated() {
    this.#draw();
  }

  #draw() {
    const canvas = this._canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dims = this.#getDimensions();
    const nodes = this.#getNodes();
    const zoom = this.#getZoom();
    const pan = this.#getPan();
    const viewport = this.#getViewport();

    const w = 150;
    const h = 100;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    if (dims.width === 0 || dims.height === 0) return;

    const scale = Math.min(w / dims.width, h / dims.height);
    const offsetX = (w - dims.width * scale) / 2;
    const offsetY = (h - dims.height * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    for (const node of nodes) {
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const nw = node.width ?? 120;
      const nh = node.height ?? 60;

      ctx.fillStyle = node.isActive ? "#4caf50" : "#e0e0e0";
      ctx.strokeStyle = node.isActive ? "#388e3c" : "#bbb";
      ctx.lineWidth = 1 / scale;
      ctx.fillRect(nx, ny, nw, nh);
      ctx.strokeRect(nx, ny, nw, nh);
    }

    const viewX = -pan.x / zoom;
    const viewY = -pan.y / zoom;
    const viewW = viewport.width / zoom;
    const viewH = viewport.height / zoom;

    ctx.strokeStyle = "#1976d2";
    ctx.lineWidth = 2 / scale;
    ctx.fillStyle = "rgba(25, 118, 210, 0.08)";
    ctx.fillRect(viewX, viewY, viewW, viewH);
    ctx.strokeRect(viewX, viewY, viewW, viewH);

    ctx.restore();
  }

  render() {
    return html`<canvas width="150" height="100"></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    minimap: Minimap;
  }
}
