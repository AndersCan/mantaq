import { LitElement, html, css } from "lit";
import { customElement, query } from "lit/decorators.js";
import { StoreController } from "@nanostores/lit";
import { $layout, $zoom, $pan } from "../stores/graph-store.ts";
import type { LayoutResult } from "../layout.ts";

@customElement("minimap")
export class Minimap extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 150px;
      height: 100px;
      background: var(--viz-bg, #fafafa);
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

  #layoutCtrl?: StoreController<LayoutResult | null>;
  #zoomCtrl?: StoreController<number>;
  #panCtrl?: StoreController<{ x: number; y: number }>;

  connectedCallback() {
    super.connectedCallback();
    this.#layoutCtrl = new StoreController(this, $layout);
    this.#zoomCtrl = new StoreController(this, $zoom);
    this.#panCtrl = new StoreController(this, $pan);
    this.addEventListener("click", this.#handleClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("click", this.#handleClick);
  }

  #getLayout(): LayoutResult | null {
    return this.#layoutCtrl?.value ?? null;
  }

  #getZoom(): number {
    return this.#zoomCtrl?.value ?? 1;
  }

  #getPan(): { x: number; y: number } {
    return this.#panCtrl?.value ?? { x: 0, y: 0 };
  }

  #handleClick = (e: MouseEvent) => {
    const canvas = this._canvas;
    if (!canvas) return;

    const layout = this.#getLayout();
    if (!layout) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const w = 150;
    const h = 100;
    const scale = Math.min(w / layout.width, h / layout.height);

    const graphX = clickX / scale;
    const graphY = clickY / scale;

    const graphEl = document.querySelector("actor-graph");
    const viewW = graphEl ? graphEl.getBoundingClientRect().width : 800;
    const viewH = graphEl ? graphEl.getBoundingClientRect().height : 600;

    const newPanX = -graphX * this.#getZoom() + viewW / 2;
    const newPanY = -graphY * this.#getZoom() + viewH / 2;

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

    const layout = this.#getLayout();
    const zoom = this.#getZoom();
    const pan = this.#getPan();

    const w = 150;
    const h = 100;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.clearRect(0, 0, w, h);
    const bgColor = getComputedStyle(this).getPropertyValue("--viz-bg").trim() || "#fafafa";
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (!layout || layout.width === 0 || layout.height === 0) return;

    const scale = Math.min(w / layout.width, h / layout.height);
    const offsetX = (w - layout.width * scale) / 2;
    const offsetY = (h - layout.height * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    for (const node of layout.nodes) {
      ctx.fillStyle = node.isActive ? "#4caf50" : "#e0e0e0";
      ctx.strokeStyle = node.isActive ? "#388e3c" : "#bbb";
      ctx.lineWidth = 1 / scale;
      ctx.fillRect(node.x, node.y, node.width, node.height);
      ctx.strokeRect(node.x, node.y, node.width, node.height);
    }

    const graphEl = document.querySelector("actor-graph");
    const viewW = graphEl ? graphEl.getBoundingClientRect().width : 800;
    const viewH = graphEl ? graphEl.getBoundingClientRect().height : 600;

    const viewX = -pan.x / zoom;
    const viewY = -pan.y / zoom;
    const viewPortW = viewW / zoom;
    const viewPortH = viewH / zoom;

    ctx.strokeStyle = "#1976d2";
    ctx.lineWidth = 2 / scale;
    ctx.fillStyle = "rgba(25, 118, 210, 0.08)";
    ctx.fillRect(viewX, viewY, viewPortW, viewPortH);
    ctx.strokeRect(viewX, viewY, viewPortW, viewPortH);

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
