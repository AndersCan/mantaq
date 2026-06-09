const EDGE_STYLES = `
  .edge-path { fill: none; stroke: var(--viz-edge-color, #9ca3af); stroke-width: 1.5; transition: stroke 0.2s ease, stroke-width 0.2s ease; }
  .edge-path.active { stroke: var(--viz-edge-active, #22c55e); stroke-width: 2; }
  .edge-arrow { fill: var(--viz-edge-color, #9ca3af); transition: fill 0.2s ease; }
  .edge-arrow.active { fill: var(--viz-edge-active, #22c55e); }
  @media (prefers-contrast: high) { .edge-path { stroke-width: 2.5; } }
`;

export class EdgePath extends HTMLElement {
  edgeId = "";
  path = "";
  label = "";
  isActive = false;
  labelX = 0;
  labelY = 0;
  graphWidth = 0;
  graphHeight = 0;
  animationClass = "";
  _lastHtml = "";

  constructor() {
    super();
    this.style.cssText = "display:block;position:absolute;pointer-events:none;";
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    try {
      const a = this.isActive ? " active" : "";
      const edgeAria = `Edge ${this.edgeId}${this.isActive ? ", active" : ""}`;

      const newHtml =
        `<style>@unocss-placeholder</style><style>${EDGE_STYLES}</style>` +
        `<svg width="${this.graphWidth || 2000}" height="${this.graphHeight || 2000}" role="img" aria-label="${edgeAria}" style="position:absolute;left:0;top:0;overflow:visible;">` +
        `<defs><marker id="arrow-${this.edgeId}" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">` +
        `<polygon class="edge-arrow${a}" points="0 0,10 3.5,0 7"/></marker></defs>` +
        `<path class="edge-path${a}" d="${this.path}" marker-end="url(#arrow-${this.edgeId})"/></svg>`;
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
