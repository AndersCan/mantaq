import { html } from "lit";
import { render } from "lit/html.js";

export class StateNode extends HTMLElement {
  _shadow: ShadowRoot;
  nodeId = "";
  label = "";
  isActive = false;
  isFinal = false;
  x = 0;
  y = 0;
  width = 120;
  height = 60;
  selected = false;

  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.addEventListener("click", this._handleInteraction);
    this.addEventListener("keydown", this._handleInteraction);
    this.requestUpdate();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._handleInteraction);
    this.removeEventListener("keydown", this._handleInteraction);
  }

  requestUpdate() {
    this.updateComplete = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        this._render();
        resolve();
      });
    });
  }

  _handleInteraction = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    if (e instanceof KeyboardEvent) e.preventDefault();
    this.dispatchEvent(
      new CustomEvent("node-select", {
        detail: { nodeId: this.nodeId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  _render() {
    const { label, isActive, isFinal, x, y, width, height, selected } = this;
    const aria = `State: ${label}${isActive ? ", active" : ""}${isFinal ? ", final" : ""}${selected ? ", selected" : ""}`;
    const fill = isActive ? "var(--viz-node-active-bg, #dcfce7)" : "var(--viz-node-bg, #ffffff)";
    const stroke = isActive
      ? "var(--viz-node-active-border, #22c55e)"
      : "var(--viz-node-border, #d1d5db)";
    const sw = isActive ? 2 : 1;

    render(
      html`<style>
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
        </style>
        <svg
          width="${width + 20}"
          height="${height + 20}"
          role="button"
          tabindex="0"
          aria-label="${aria}"
          style="position:absolute;left:${x - 10}px;top:${y - 10}px;overflow:visible"
        >
          <g class="node">
            ${isActive
              ? html`<rect
                  class="active-glow"
                  x="-4"
                  y="-4"
                  width="${width + 8}"
                  height="${height + 8}"
                />`
              : null}
            ${selected
              ? html`<rect
                  class="selection-ring"
                  x="-6"
                  y="-6"
                  width="${width + 12}"
                  height="${height + 12}"
                />`
              : null}
            <rect
              class="node-bg"
              x="0"
              y="0"
              width="${width}"
              height="${height}"
              rx="6"
              fill="${fill}"
              stroke="${stroke}"
              stroke-width="${sw}"
            />
            <text
              class="node-label"
              x="${width / 2}"
              y="${height / 2}"
              text-anchor="middle"
              dominant-baseline="central"
            >
              ${label}
            </text>
            ${isFinal
              ? html`<rect
                  class="final-indicator"
                  x="4"
                  y="4"
                  width="${width - 8}"
                  height="${height - 8}"
                />`
              : null}
          </g>
        </svg>`,
      this._shadow,
    );
  }
}

customElements.define("state-node", StateNode);
