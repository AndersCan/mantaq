const stateNodeStyles = `
  :host { display: block; position: absolute; contain: layout style; will-change: transform; }
  .node { transition: filter 0.2s ease; will-change: filter; }
  .node:hover { filter: brightness(1.1); }
  .node:focus { outline: none; }
  .node:focus-visible .node-bg { stroke: var(--viz-accent, #3b82f6); stroke-width: 2; }
  .node-bg { transition: fill 0.3s ease, stroke 0.3s ease, stroke-width 0.2s ease; }
  .node-label {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
    fill: var(--viz-node-label);
  }
  .final-indicator { fill: none; stroke: var(--viz-accent, #6366f1); stroke-width: 1.5; rx: 4; }
  .active-glow {
    fill: none; stroke: var(--viz-node-active-border, #22c55e);
    stroke-width: 3; rx: 8; animation: glow-pulse 2s ease-in-out infinite;
  }
  @keyframes glow-pulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.6; } }
  .node-activate {
    animation: node-activate-pulse 0.6s ease-out;
  }
  @keyframes node-activate-pulse {
    0% { transform: scale(1); filter: brightness(1); }
    30% { transform: scale(1.08); filter: brightness(1.3); }
    60% { transform: scale(0.98); filter: brightness(1.1); }
    100% { transform: scale(1); filter: brightness(1); }
  }
  .node-deactivate {
    animation: node-deactivate-fade 0.4s ease-in;
  }
  @keyframes node-deactivate-fade {
    0% { opacity: 1; }
    50% { opacity: 0.6; }
    100% { opacity: 1; }
  }
  .node-enter {
    animation: node-enter 0.4s ease-out;
  }
  @keyframes node-enter {
    0% { opacity: 0; transform: scale(0.8); }
    60% { opacity: 1; transform: scale(1.05); }
    100% { opacity: 1; transform: scale(1); }
  }
  .selection-ring {
    fill: none; stroke: var(--viz-accent, #3b82f6); stroke-width: 2;
    stroke-dasharray: 6 3; stroke-dashoffset: 0; rx: 8; animation: marching-ants 0.6s linear infinite;
  }
  @keyframes marching-ants { to { stroke-dashoffset: -9; } }
  .timer-track { fill: var(--viz-timer-track, #e5e7eb); }
  .timer-fill {
    fill: var(--viz-timer-fill, #f59e0b);
    transition: width 0.3s linear;
  }
  .timer-icon {
    fill: none; stroke: var(--viz-timer-text, #92400e); stroke-width: 1.5;
  }
  .visited-indicator {
    fill: var(--viz-visited-bg, #fef3c7);
  }
  .search-match .node-bg {
    stroke: var(--viz-accent, #6366f1);
    stroke-width: 2.5;
  }
  :host(.dimmed) { opacity: 0.25; pointer-events: none; }
  @media (max-width: 768px) {
    .node-label { font-size: 12px; }
  }
  @media (max-width: 480px) {
    .node-label { font-size: 11px; }
  }
  @media (prefers-reduced-motion: reduce) { .active-glow, .selection-ring, .timer-fill, .node-activate, .node-deactivate, .node-enter { animation: none; transition: none; } }
  @media (prefers-contrast: high) { .node-bg { stroke-width: 3; } .node-label { font-weight: bold; } .selection-ring { stroke-width: 3; } }
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
  contextData: unknown = null;
  hasTimer = false;
  timerProgress = 0;
  animationClass = "";
  searchMatch = false;
  visited = false;
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
    const {
      label,
      isActive,
      isFinal,
      x,
      y,
      width,
      height,
      selected,
      contextData,
      hasTimer,
      timerProgress,
      animationClass,
      searchMatch,
    } = el;
    const aria = `State: ${label}${isActive ? ", active" : ""}${isFinal ? ", final" : ""}${selected ? ", selected" : ""}${hasTimer ? ", timer active" : ""}`;
    const fill = isActive ? "var(--viz-node-active-bg, #dcfce7)" : "var(--viz-node-bg, #ffffff)";
    const stroke = isActive
      ? "var(--viz-node-active-border, #22c55e)"
      : "var(--viz-node-border, #d1d5db)";
    const sw = isActive ? 2 : 1;

    const barY = height - 6;
    const barWidth = width - 12;
    const fillWidth = Math.max(0, Math.min(barWidth * (timerProgress / 100), barWidth));

    const contextHtml =
      selected && contextData != null
        ? `<foreignObject x="${width + 8}" y="0" width="200" height="120" style="overflow:visible">
          <div xmlns="http://www.w3.org/1999/xhtml" style="
            background: var(--viz-context-bg, #f8fafc);
            border: 1px solid var(--viz-context-border, #e2e8f0);
            border-radius: 6px;
            padding: 6px 8px;
            font-family: monospace;
            font-size: 11px;
            color: var(--viz-context-text, #475569);
            max-height: 110px;
            overflow: auto;
            box-shadow: 0 2px 6px rgba(0,0,0,.08);
            white-space: pre-wrap;
            word-break: break-all;
          ">${serializeContext(contextData)}</div>
         </foreignObject>`
        : "";

    const newHtml =
      `<style>@unocss-placeholder</style><style>${stateNodeStyles}</style>` +
      `<svg width="${width + 220}" height="${height + 20}" role="button" tabindex="0" aria-label="${aria}" ` +
      `style="position:absolute;left:${x - 10}px;top:${y - 10}px;overflow:visible">` +
      `<g class="node cursor-pointer ${animationClass}${searchMatch ? " search-match" : ""}">` +
      (isActive
        ? `<rect class="active-glow opacity-40" x=-4 y=-4 width=${width + 8} height=${height + 8}/>`
        : "") +
      (selected
        ? `<rect class="selection-ring" x=-6 y=-6 width=${width + 12} height=${height + 12}/>`
        : "") +
      `<rect class="node-bg" x=0 y=0 width=${width} height=${height} rx=6 fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
      `<text class="node-label text-[13px] pointer-events-none select-none${searchMatch ? " font-bold" : ""}" x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central">${escapeHtml(String(label ?? ""))}</text>` +
      (isFinal
        ? `<rect class="final-indicator" x=4 y=4 width=${width - 8} height=${height - 8}/>`
        : "") +
      (hasTimer
        ? `<rect class="timer-track" x=6 y=${barY} width=${barWidth} height=4 rx=2/>` +
          `<rect class="timer-fill" x=6 y=${barY} width=${fillWidth} height=4 rx=2/>` +
          `<circle class="timer-icon" cx=${width - 14} cy=14 r=6/>` +
          `<line class="timer-icon" x1=${width - 14} y1=14 x2=${width - 14} y2=11/>` +
          `<line class="timer-icon" x1=${width - 14} y1=14 x2=${width - 11} y2=14/>`
        : "") +
      `</g>${contextHtml}</svg>`;
    if (newHtml === el._lastHtml) return;
    el._lastHtml = newHtml;
    el.innerHTML = newHtml;
  } catch {
    el.innerHTML =
      `<style>@unocss-placeholder</style><style>${stateNodeStyles}</style>` +
      `<svg width="140" height="80" style="position:absolute;left:0;top:0">` +
      `<rect x=0 y=0 width=120 height=60 rx=6 fill="var(--viz-error-bg, #fef2f2)" stroke="var(--viz-error-border, #fecaca)"/>` +
      `<text x="60" y="30" text-anchor="middle" dominant-baseline="central" fill="var(--viz-error-text, #dc2626)" font-size="11">Error</text>` +
      `</svg>`;
  }
}

function serializeContext(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return escapeHtml(data);
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      },
      2,
    );
    return escapeHtml(json ?? "");
  } catch {
    return "[Unserializable]";
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
