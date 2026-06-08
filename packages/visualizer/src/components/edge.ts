export class EdgePath extends HTMLElement {
  edgeId = "";
  path = "";
  label = "";
  isActive = false;
  labelX = 0;
  labelY = 0;
  graphWidth = 0;
  graphHeight = 0;

  constructor() {
    super();
    this.style.cssText = "display:block;position:absolute;pointer-events:none;";
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const lw = this.label ? this.label.length * 6.5 + 16 : 0;
    const a = this.isActive ? " active" : "";
    const lbl = this.label
      ? `<rect class="edge-label-bg" x="${this.labelX - lw / 2}" y="${this.labelY - 9}" width="${lw}" height="18"/>` +
        `<text class="edge-label${a}" x="${this.labelX}" y="${this.labelY}" text-anchor="middle" dominant-baseline="central">${this.label}</text>`
      : "";
    this.innerHTML =
      `<svg width="${this.graphWidth || 2000}" height="${this.graphHeight || 2000}" style="position:absolute;left:0;top:0;overflow:visible;">` +
      `<defs><marker id="arrow-${this.edgeId}" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">` +
      `<polygon class="edge-arrow${a}" points="0 0,10 3.5,0 7"/></marker></defs>` +
      `<path class="edge-path${a}" d="${this.path}" marker-end="url(#arrow-${this.edgeId})"/>${lbl}</svg>`;
  }
}

customElements.define("edge-path", EdgePath);
