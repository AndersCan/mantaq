const stateNodeStyles = `
  :host { display: block; position: absolute; contain: layout style; }
  .node { cursor: pointer; }
  .node:hover { filter: brightness(1.1); }
  .node:focus { outline: none; }
  .node:focus-visible .node-bg { stroke: var(--viz-accent, #3b82f6); stroke-width: 2; }
  .node-bg { transition: fill 0.2s ease, stroke 0.2s ease; }
  .node-label {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
    fill: var(--viz-node-label);
  }
  .final-indicator { fill: none; stroke: var(--viz-accent, #6366f1); stroke-width: 1.5; rx: 4; }
  .active-glow {
    fill: none; stroke: var(--viz-node-active-border, #22c55e);
    stroke-width: 3; rx: 8;
  }
  .selected-ring {
    fill: none; stroke: var(--viz-accent, #3b82f6); stroke-width: 2; rx: 8;
  }
  @media (max-width: 768px) { .node-label { font-size: 12px; } }
  @media (max-width: 480px) { .node-label { font-size: 11px; } }
  @media (prefers-contrast: high) { .node-bg { stroke-width: 3; } .node-label { font-weight: bold; } }
`;

export class StateNode extends HTMLElement {
  nodeId = "";
  label = "";
  isActive = false;
  isFinal = false;
  x = 0;
  y = 0;
  width = 120;
  height = 60;
  selected = false;
  _lastHtml = "";

  updateComplete = Promise.resolve();

  connectedCallback() {
    this.addEventListener("click", this._handleInteraction);
    this.addEventListener("keydown", this._handleInteraction);
    this.requestUpdate();
  }

  requestUpdate() {
    this.updateComplete = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        renderStateNode(this);
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
}

function renderStateNode(el: StateNode) {
  try {
    const { label, isActive, isFinal, x, y, width, height, selected } = el;
    const aria = `State: ${label}${isActive ? ", active" : ""}${isFinal ? ", final" : ""}${selected ? ", selected" : ""}`;
    const fill = isActive ? "var(--viz-node-active-bg, #dcfce7)" : "var(--viz-node-bg, #ffffff)";
    const stroke = isActive
      ? "var(--viz-node-active-border, #22c55e)"
      : "var(--viz-node-border, #d1d5db)";
    const sw = isActive ? 2 : 1;

    const newHtml =
      `<style>@unocss-placeholder</style><style>${stateNodeStyles}</style>` +
      `<svg width="${width}" height="${height}" role="button" tabindex="0" aria-label="${aria}" ` +
      `style="position:absolute;left:${x}px;top:${y}px">` +
      `<g class="node">` +
      (isActive
        ? `<rect class="active-glow" x=-4 y=-4 width=${width + 8} height=${height + 8}/>`
        : "") +
      (selected
        ? `<rect class="selected-ring" x=-6 y=-6 width=${width + 12} height=${height + 12}/>`
        : "") +
      `<rect class="node-bg" x=0 y=0 width=${width} height=${height} rx=6 fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
      `<text class="node-label text-[13px] pointer-events-none select-none" x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central">${escapeHtml(String(label ?? ""))}</text>` +
      (isFinal
        ? `<rect class="final-indicator" x=4 y=4 width=${width - 8} height=${height - 8}/>`
        : "") +
      `</g></svg>`;
    if (newHtml === el._lastHtml) return;
    el._lastHtml = newHtml;
    el.innerHTML = newHtml;
  } catch {
    el.innerHTML =
      `<style>@unocss-placeholder</style><style>${stateNodeStyles}</style>` +
      `<svg width="120" height="60" style="position:absolute;left:0;top:0">` +
      `<rect x=0 y=0 width=120 height=60 rx=6 fill="var(--viz-error-bg, #fef2f2)" stroke="var(--viz-error-border, #fecaca)"/>` +
      `<text x="60" y="30" text-anchor="middle" dominant-baseline="central" fill="var(--viz-error-text, #dc2626)" font-size="11">Error</text>` +
      `</svg>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

customElements.define("state-node", StateNode);
