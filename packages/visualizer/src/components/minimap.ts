import { atom } from "nanostores";
import type { LayoutResult } from "../layout.ts";
import { $zoom, $pan, $layout } from "../graph-store.ts";
import { isTouchEvent } from "../types.ts";

export const $minimapVisible = atom(false);

const MINIMAP_W = 180;
const MINIMAP_H = 120;
const PADDING = 8;

export class MinimapComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _canvas: HTMLCanvasElement | null = null;
  _layout: LayoutResult | null = null;
  _zoom = 1;
  _pan = { x: 0, y: 0 };
  _containerW = 800;
  _containerH = 600;
  _unsubscribers: Array<() => void> = [];
  _dragging = false;
  _dragOffset = { x: 0, y: 0 };
  _abort: AbortController | null = null;
  _cachedStyle: {
    bg: string;
    nodeBg: string;
    nodeBorder: string;
    activeBorder: string;
    edgeColor: string;
    accentColor: string;
  } | null = null;
  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $layout.subscribe((v) => {
        this._layout = v;
        this._renderComponent();
      }),
      $zoom.subscribe((v) => {
        this._zoom = v;
        this._renderCanvas();
      }),
      $pan.subscribe((v) => {
        this._pan = v;
        this._renderCanvas();
      }),
    );

    this._renderComponent();
  }

  disconnectedCallback() {
    this._abort?.abort();
    this._abort = null;
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  setContainerSize(w: number, h: number) {
    this._containerW = w;
    this._containerH = h;
    this._renderCanvas();
  }

  _attachEvents() {
    const canvas = this._canvas;
    if (!canvas) return;
    this._abort?.abort();
    this._abort = new AbortController();
    const s = this._abort.signal;
    canvas.addEventListener("mousedown", this._handleMouseDown, { signal: s });
    canvas.addEventListener("touchstart", this._handleTouchStart, { passive: false, signal: s });
    canvas.addEventListener("touchmove", this._handleTouchMove, { passive: false, signal: s });
    canvas.addEventListener("touchend", this._handleTouchEnd, { signal: s });
    window.addEventListener("mousemove", this._handleMouseMove, { signal: s });
    window.addEventListener("mouseup", this._handleMouseUp, { signal: s });
  }

  _getScale() {
    if (!this._layout) return { scale: 1, offsetX: 0, offsetY: 0 };
    const lw = this._layout.width || 1;
    const lh = this._layout.height || 1;
    const dw = MINIMAP_W - PADDING * 2;
    const dh = MINIMAP_H - PADDING * 2;
    const scale = Math.min(dw / lw, dh / lh);
    const offsetX = PADDING + (dw - lw * scale) / 2;
    const offsetY = PADDING + (dh - lh * scale) / 2;
    return { scale, offsetX, offsetY };
  }

  _minimapToGraph(mx: number, my: number) {
    const { scale, offsetX, offsetY } = this._getScale();
    const gx = (mx - offsetX) / scale;
    const gy = (my - offsetY) / scale;
    return {
      x: this._containerW / 2 - gx * this._zoom,
      y: this._containerH / 2 - gy * this._zoom,
    };
  }

  _handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this._dragging = true;
    const rect = this._canvas!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newPan = this._minimapToGraph(mx, my);
    $pan.set(newPan);
    this._dragOffset = { x: mx, y: my };
  };

  _handleMouseMove = (e: MouseEvent) => {
    if (!this._dragging) return;
    const rect = this._canvas!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newPan = this._minimapToGraph(mx, my);
    $pan.set(newPan);
    this._dragOffset = { x: mx, y: my };
  };

  _handleMouseUp = () => {
    this._dragging = false;
  };

  _handleTouchStart = (e: Event) => {
    if (!isTouchEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    this._dragging = true;
    const rect = this._canvas!.getBoundingClientRect();
    const mx = e.touches[0].clientX - rect.left;
    const my = e.touches[0].clientY - rect.top;
    const newPan = this._minimapToGraph(mx, my);
    $pan.set(newPan);
    this._dragOffset = { x: mx, y: my };
  };

  _handleTouchMove = (e: Event) => {
    if (!this._dragging || !isTouchEvent(e)) return;
    e.preventDefault();
    const rect = this._canvas!.getBoundingClientRect();
    const mx = e.touches[0].clientX - rect.left;
    const my = e.touches[0].clientY - rect.top;
    const newPan = this._minimapToGraph(mx, my);
    $pan.set(newPan);
    this._dragOffset = { x: mx, y: my };
  };

  _handleTouchEnd = () => {
    this._dragging = false;
  };

  _renderCanvas() {
    const canvas = this._canvas;
    const layout = this._layout;
    if (!canvas || !layout) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = MINIMAP_W * dpr;
    canvas.height = MINIMAP_H * dpr;
    ctx.scale(dpr, dpr);

    if (!this._cachedStyle) {
      const style = getComputedStyle(this);
      this._cachedStyle = {
        bg: style.getPropertyValue("--viz-bg").trim() || "#fafafa",
        nodeBg: style.getPropertyValue("--viz-node-bg").trim() || "#ffffff",
        nodeBorder: style.getPropertyValue("--viz-node-border").trim() || "#d1d5db",
        activeBorder: style.getPropertyValue("--viz-node-active-border").trim() || "#22c55e",
        edgeColor: style.getPropertyValue("--viz-edge-color").trim() || "#9ca3af",
        accentColor: style.getPropertyValue("--viz-accent").trim() || "#3b82f6",
      };
    }
    const {
      bg: bgColor,
      nodeBg,
      nodeBorder,
      activeBorder,
      edgeColor,
      accentColor,
    } = this._cachedStyle;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    const { scale, offsetX, offsetY } = this._getScale();

    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 0.5;
    for (const edge of layout.edges) {
      const sm = edge.path.match(/[\d.]+/g);
      if (!sm || sm.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(offsetX + parseFloat(sm[0]) * scale, offsetY + parseFloat(sm[1]) * scale);
      for (let i = 2; i < sm.length; i += 2) {
        ctx.lineTo(offsetX + parseFloat(sm[i]) * scale, offsetY + parseFloat(sm[i + 1]) * scale);
      }
      ctx.stroke();
    }

    for (const node of layout.nodes) {
      const nx = offsetX + node.x * scale;
      const ny = offsetY + node.y * scale;
      const nw = node.width * scale;
      const nh = node.height * scale;
      ctx.fillStyle = node.isActive ? activeBorder : nodeBg;
      ctx.strokeStyle = node.isActive ? activeBorder : nodeBorder;
      ctx.lineWidth = node.isActive ? 1.5 : 0.5;
      ctx.fillRect(nx, ny, nw, nh);
      ctx.strokeRect(nx, ny, nw, nh);
    }

    const vx = offsetX + (-this._pan.x / this._zoom) * scale;
    const vy = offsetY + (-this._pan.y / this._zoom) * scale;
    const vw = (this._containerW / this._zoom) * scale;
    const vh = (this._containerH / this._zoom) * scale;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  _renderComponent() {
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });

    this._cachedStyle = null;

    const canvasHtml = this._layout
      ? `<canvas class="minimap-canvas block cursor-crosshair touch-none" width="${MINIMAP_W}" height="${MINIMAP_H}"></canvas>`
      : "";

    const style = `<style>
      @unocss-placeholder
      :host { display: block; }
      .minimap-container { width: ${MINIMAP_W}px; height: ${MINIMAP_H}px; border-radius: 6px; border: 1px solid var(--viz-border, #e5e7eb); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); background: var(--viz-bg, #fafafa); }
      @media (max-width: 768px) {
        .minimap-container { width: 140px; height: 90px; }
        .minimap-canvas { width: 140px; height: 90px; }
      }
      @media (max-width: 480px) {
        .minimap-container { width: 100px; height: 65px; border-radius: 4px; }
        .minimap-canvas { width: 100px; height: 65px; }
      }
    </style>`;

    const template = document.createElement("template");
    template.innerHTML = `${style}<div class="minimap-container">${canvasHtml}</div>`;
    this._shadow.innerHTML = "";
    this._shadow.appendChild(template.content.cloneNode(true));

    this._canvas = this._shadow.querySelector(".minimap-canvas") as HTMLCanvasElement | null;
    this._attachEvents();
    this._renderCanvas();
    resolve!();
  }
}

customElements.define("minimap-component", MinimapComponent);
