import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("state-node")
export class StateNode extends LitElement {
  @property({ type: String }) declare nodeId: string;
  @property({ type: String }) declare label: string;
  @property({ type: Boolean }) declare isActive: boolean;
  @property({ type: Boolean }) declare isFinal: boolean;
  @property({ type: Number }) declare x: number;
  @property({ type: Number }) declare y: number;
  @property({ type: Number }) declare width: number;
  @property({ type: Number }) declare height: number;
  @property({ type: Boolean }) declare selected: boolean;

  static styles = css`
    :host {
      display: block;
      position: absolute;
    }

    .node {
      cursor: pointer;
      transition: filter 0.2s ease;
    }

    .node:hover {
      filter: brightness(1.1);
    }

    .node:focus {
      outline: none;
    }

    .node:focus-visible .node-bg {
      stroke: var(--viz-accent, #3b82f6);
      stroke-width: 2;
    }

    .node-bg {
      transition:
        fill 0.3s ease,
        stroke 0.3s ease,
        stroke-width 0.2s ease;
    }

    .node-label {
      font-family:
        "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
      font-size: 13px;
      fill: var(--viz-node-label);
      pointer-events: none;
      user-select: none;
    }

    .final-indicator {
      fill: none;
      stroke: var(--viz-accent, #6366f1);
      stroke-width: 1.5;
      rx: 4;
    }

    .active-glow {
      fill: none;
      stroke: var(--viz-node-active-border, #22c55e);
      stroke-width: 3;
      opacity: 0.4;
      rx: 8;
      animation: glow-pulse 2s ease-in-out infinite;
    }

    @keyframes glow-pulse {
      0%,
      100% {
        opacity: 0.2;
      }
      50% {
        opacity: 0.6;
      }
    }

    .selection-ring {
      fill: none;
      stroke: var(--viz-accent, #3b82f6);
      stroke-width: 2;
      stroke-dasharray: 6 3;
      stroke-dashoffset: 0;
      rx: 8;
      animation: marching-ants 0.6s linear infinite;
    }

    @keyframes marching-ants {
      to {
        stroke-dashoffset: -9;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .active-glow,
      .selection-ring {
        animation: none;
      }
    }
  `;

  constructor() {
    super();
    this.nodeId = "";
    this.label = "";
    this.isActive = false;
    this.isFinal = false;
    this.x = 0;
    this.y = 0;
    this.width = 120;
    this.height = 60;
    this.selected = false;
  }

  private handleClick = () => {
    this.dispatchEvent(
      new CustomEvent("node-select", {
        detail: { nodeId: this.nodeId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.handleClick();
    }
  };

  render() {
    const ariaLabel = `State: ${this.label}${this.isActive ? ", active" : ""}${this.isFinal ? ", final" : ""}${this.selected ? ", selected" : ""}`;

    return html`
      <svg
        .width=${this.width + 20}
        .height=${this.height + 20}
        role="button"
        tabindex="0"
        aria-label=${ariaLabel}
        style="position: absolute; left: ${this.x - 10}px; top: ${this.y -
        10}px; overflow: visible;"
      >
        <g class="node" @click=${this.handleClick} @keydown=${this.handleKeyDown}>
          ${this.isActive
            ? html`<rect
                class="active-glow"
                x=${-4}
                y=${-4}
                width=${this.width + 8}
                height=${this.height + 8}
              />`
            : ""}
          ${this.selected
            ? html`<rect
                class="selection-ring"
                x=${-6}
                y=${-6}
                width=${this.width + 12}
                height=${this.height + 12}
              />`
            : ""}
          <rect
            class="node-bg"
            x=${0}
            y=${0}
            width=${this.width}
            height=${this.height}
            rx=${6}
            fill=${this.isActive
              ? "var(--viz-node-active-bg, #dcfce7)"
              : "var(--viz-node-bg, #ffffff)"}
            stroke=${this.isActive
              ? "var(--viz-node-active-border, #22c55e)"
              : "var(--viz-node-border, #d1d5db)"}
            stroke-width=${this.isActive ? 2 : 1}
          />
          <text
            class="node-label"
            x=${this.width / 2}
            y=${this.height / 2}
            text-anchor="middle"
            dominant-baseline="central"
          >
            ${this.label}
          </text>
          ${this.isFinal
            ? html`<rect
                class="final-indicator"
                x=${4}
                y=${4}
                width=${this.width - 8}
                height=${this.height - 8}
              />`
            : ""}
        </g>
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "state-node": StateNode;
  }
}
