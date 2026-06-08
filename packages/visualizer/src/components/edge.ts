import { html } from "lit";
import { render } from "lit/html.js";

export class EdgePath extends HTMLElement {
  _shadow: ShadowRoot;
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
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const { label, isActive, edgeId, path, labelX, labelY, graphWidth, graphHeight } = this;
    const lw = label ? label.length * 6.5 + 16 : 0;
    const a = isActive ? " active" : "";

    render(
      html`<svg
        width="${graphWidth || 2000}"
        height="${graphHeight || 2000}"
        style="position:absolute;left:0;top:0;overflow:visible;"
      >
        <defs>
          <marker
            id="arrow-${edgeId}"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <polygon class="edge-arrow${a}" points="0 0,10 3.5,0 7" />
          </marker>
        </defs>
        <path class="edge-path${a}" d="${path}" marker-end="url(#arrow-${edgeId})" />
        ${label
          ? html`<rect
                class="edge-label-bg"
                x="${labelX - lw / 2}"
                y="${labelY - 9}"
                width="${lw}"
                height="18"
              />
              <text
                class="edge-label${a}"
                x="${labelX}"
                y="${labelY}"
                text-anchor="middle"
                dominant-baseline="central"
              >
                ${label}
              </text>`
          : null}
      </svg>`,
      this._shadow,
    );
  }
}

customElements.define("edge-path", EdgePath);
