import type { EdgeSelectDetail } from "../types.ts";

const EDGE_STYLES = `
  .edge-path { fill: none; stroke: var(--viz-edge-color, #9ca3af); stroke-width: 1.5; transition: stroke 0.3s ease, stroke-width 0.2s ease; }
  .edge-path.active { stroke: var(--viz-edge-active, #22c55e); stroke-width: 2; }
  .edge-path.traversal { stroke-dasharray: 8 4; animation: edge-traversal 0.6s linear; }
  @keyframes edge-traversal { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
  .edge-arrow { fill: var(--viz-edge-color, #9ca3af); transition: fill 0.3s ease; }
  .edge-arrow.active { fill: var(--viz-edge-active, #22c55e); }
  .edge-label-bg { fill: var(--viz-bg, #fafafa); rx: 3; }
  .edge-label { fill: var(--viz-edge-label, #6b7280); transition: fill 0.3s ease; }
  .edge-label.active { fill: var(--viz-edge-active, #22c55e); }
  .guard-bg { fill: var(--viz-payload-guard-bg, #fef3c7); stroke: var(--viz-payload-guard-border, #f59e0b); stroke-width: 0.5; }
  .guard-text { fill: var(--viz-payload-guard-text, #92400e); }
  .action-bg { fill: var(--viz-payload-action-bg, #dbeafe); stroke: var(--viz-payload-action-border, #3b82f6); stroke-width: 0.5; }
  .action-text { fill: var(--viz-payload-action-text, #1e40af); }
  .timer-badge-bg { fill: var(--viz-timer-badge-bg, #fef3c7); stroke: var(--viz-timer-badge-border, #f59e0b); stroke-width: 0.5; }
  .timer-badge-text { fill: var(--viz-timer-badge-text, #92400e); }
  @media (max-width: 768px) {
    .edge-label { font-size: 10px; }
    .guard-text, .action-text, .timer-badge-text { font-size: 8px; }
  }
  @media (prefers-reduced-motion: reduce) { .edge-path.traversal { animation: none; } }
  @media (prefers-contrast: high) { .edge-path { stroke-width: 2.5; } .edge-label { font-weight: bold; } }
`;

function escSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class EdgePath extends HTMLElement {
  edgeId = "";
  path = "";
  label = "";
  isActive = false;
  labelX = 0;
  labelY = 0;
  graphWidth = 0;
  graphHeight = 0;
  guard = "";
  action = "";
  timerLabel = "";
  animationClass = "";
  _lastHtml = "";

  constructor() {
    super();
    this.style.cssText = "display:block;position:absolute;pointer-events:none;";
  }

  connectedCallback() {
    this._render();
    this._attachClick();
  }

  _attachClick() {
    const zone = this.querySelector(".edge-click-zone");
    if (!zone) return;
    zone.addEventListener("click", (e) => {
      e.stopPropagation();
      const detail: EdgeSelectDetail = {
        edgeId: this.edgeId,
        label: this.label,
        guard: this.guard,
        action: this.action,
      };
      this.dispatchEvent(
        new CustomEvent("edge-select", {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  _render() {
    try {
      const lw = this.label ? this.label.length * 6.5 + 16 : 0;
      const a = this.isActive ? " active" : "";
      const t = this.animationClass ? ` ${this.animationClass}` : "";
      const lbl = this.label
        ? `<rect class="edge-label-bg" x="${this.labelX - lw / 2}" y="${this.labelY - 9}" width="${lw}" height="18"/>` +
          `<text class="edge-label font-mono text-[11px]${a}" x="${this.labelX}" y="${this.labelY}" text-anchor="middle" dominant-baseline="central">${escSvg(this.label)}</text>`
        : "";

      let badges = "";
      const badgeY = this.labelY + 14;
      if (this.guard) {
        const gw = Math.min(this.guard.length, 18) * 5.5 + 12;
        const display = this.guard.length > 18 ? this.guard.slice(0, 16) + ".." : this.guard;
        badges +=
          `<g class="edge-badge guard-badge">` +
          `<rect class="guard-bg" x="${this.labelX - gw / 2}" y="${badgeY - 7}" width="${gw}" height="14" rx="3"/>` +
          `<text class="guard-text font-mono text-[9px]" x="${this.labelX}" y="${badgeY}" text-anchor="middle" dominant-baseline="central">${escSvg(display)}</text>` +
          `</g>`;
      }
      if (this.action) {
        const aw = Math.min(this.action.length, 22) * 5.5 + 12;
        const ay = this.guard ? badgeY + 14 : badgeY;
        const display = this.action.length > 22 ? this.action.slice(0, 20) + ".." : this.action;
        badges +=
          `<g class="edge-badge action-badge">` +
          `<rect class="action-bg" x="${this.labelX - aw / 2}" y="${ay - 7}" width="${aw}" height="14" rx="3"/>` +
          `<text class="action-text font-mono text-[9px]" x="${this.labelX}" y="${ay}" text-anchor="middle" dominant-baseline="central">${escSvg(display)}</text>` +
          `</g>`;
      }

      let timerBadge = "";
      if (this.timerLabel) {
        const tw = this.timerLabel.length * 6 + 12;
        const ty = this.labelY + (this.guard || this.action ? 30 : 16);
        timerBadge =
          `<rect class="timer-badge-bg" x="${this.labelX - tw / 2}" y="${ty - 7}" width="${tw}" height="14" rx="3"/>` +
          `<text class="timer-badge-text font-mono text-[9px]" x="${this.labelX}" y="${ty}" text-anchor="middle" dominant-baseline="central">${this.timerLabel}</text>`;
      }

      const clickZone =
        this.guard || this.action
          ? `<rect class="edge-click-zone" x="${this.labelX - 40}" y="${this.labelY - 12}" width="80" height="${this.guard && this.action ? 44 : 30}" fill="transparent" style="pointer-events:all;cursor:pointer;"/>`
          : "";

      const edgeAria = `Edge ${escSvg(this.label || this.edgeId)}${this.isActive ? ", active" : ""}`;
      const clickZoneAria =
        this.guard || this.action
          ? `<rect class="edge-click-zone" x="${this.labelX - 40}" y="${this.labelY - 12}" width="80" height="${this.guard && this.action ? 44 : 30}" fill="transparent" style="pointer-events:all;cursor:pointer;" role="button" aria-label="${edgeAria}${this.guard ? `, guard: ${escSvg(this.guard)}` : ""}${this.action ? `, action: ${escSvg(this.action)}` : ""}"/>`
          : clickZone;

      const newHtml =
        `<style>@unocss-placeholder</style><style>${EDGE_STYLES}</style>` +
        `<svg width="${this.graphWidth || 2000}" height="${this.graphHeight || 2000}" role="img" aria-label="${edgeAria}" style="position:absolute;left:0;top:0;overflow:visible;">` +
        `<defs><marker id="arrow-${this.edgeId}" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">` +
        `<polygon class="edge-arrow${a}" points="0 0,10 3.5,0 7"/></marker></defs>` +
        `<path class="edge-path${a}${t}" d="${this.path}" marker-end="url(#arrow-${this.edgeId})"/>${lbl}${badges}${timerBadge}${clickZoneAria}</svg>`;
      if (newHtml === this._lastHtml) return;
      this._lastHtml = newHtml;
      this.innerHTML = newHtml;
    } catch {
      this.innerHTML =
        `<style>@unocss-placeholder</style><style>${EDGE_STYLES}</style>` +
        `<svg width="100" height="20" style="position:absolute;left:0;top:0">` +
        `<text x="10" y="14" fill="var(--viz-error-text, #dc2626)" font-size="10">Edge error</text>` +
        `</svg>`;
    }
  }
}

customElements.define("edge-path", EdgePath);
