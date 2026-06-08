import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("edge-path")
export class EdgePath extends LitElement {
  @property({ type: String }) declare edgeId: string;
  @property({ type: String }) declare path: string;
  @property({ type: String }) declare label: string;
  @property({ type: Boolean }) declare isActive: boolean;
  @property({ type: Number }) declare labelX: number;
  @property({ type: Number }) declare labelY: number;

  static styles = css`
    :host {
      display: block;
      position: absolute;
      pointer-events: none;
    }

    .edge-path {
      fill: none;
      stroke: var(--viz-edge-color, #9ca3af);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition:
        stroke 0.3s ease,
        stroke-width 0.2s ease;
    }

    .edge-path.active {
      stroke: var(--viz-edge-active, #22c55e);
      stroke-width: 2.5;
    }

    .edge-label {
      font-family:
        "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
      font-size: 11px;
      fill: var(--viz-edge-label, #6b7280);
      pointer-events: none;
      user-select: none;
    }

    .edge-label.active {
      fill: var(--viz-edge-active, #22c55e);
      font-weight: 600;
    }

    .edge-label-bg {
      fill: var(--viz-node-bg);
      rx: 3;
      opacity: 0.9;
    }

    .edge-label.active {
      fill: var(--viz-edge-active, #22c55e);
      font-weight: 600;
    }

    .edge-arrow {
      fill: var(--viz-edge-color, #9ca3af);
      transition: fill 0.3s ease;
    }

    .edge-arrow.active {
      fill: var(--viz-edge-active, #22c55e);
    }
  `;

  constructor() {
    super();
    this.edgeId = "";
    this.path = "";
    this.label = "";
    this.isActive = false;
    this.labelX = 0;
    this.labelY = 0;
  }

  render() {
    const labelBgWidth = this.label ? this.label.length * 6.5 + 16 : 0;
    const labelBgHeight = 18;

    return html`
      <svg
        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible;"
      >
        <defs>
          <marker
            id="arrow-${this.edgeId}"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <polygon
              class="edge-arrow ${this.isActive ? "active" : ""}"
              points="0 0, 10 3.5, 0 7"
            />
          </marker>
        </defs>
        <path
          class="edge-path ${this.isActive ? "active" : ""}"
          d=${this.path}
          marker-end=${`url(#arrow-${this.edgeId})`}
        />
        ${this.label
          ? html`
              <rect
                class="edge-label-bg"
                x=${this.labelX - labelBgWidth / 2}
                y=${this.labelY - labelBgHeight / 2}
                width=${labelBgWidth}
                height=${labelBgHeight}
              />
              <text
                class="edge-label ${this.isActive ? "active" : ""}"
                x=${this.labelX}
                y=${this.labelY}
                text-anchor="middle"
                dominant-baseline="central"
              >
                ${this.label}
              </text>
            `
          : ""}
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "edge-path": EdgePath;
  }
}
