import { svg, type SVGTemplateResult } from "lit-html";
import type { ComputedEdge } from "../layout.ts";

const LABEL_PADDING = 4;
const LABEL_FONT_SIZE = 12;
const LABEL_APPROX_CHAR_WIDTH = 7;

export function renderEdge(edge: ComputedEdge): SVGTemplateResult {
  if (!edge.path) return svg``;

  const labelText = edge.guard ? `${edge.label} [${edge.guard}]` : edge.label;
  const labelWidth = labelText.length * LABEL_APPROX_CHAR_WIDTH + LABEL_PADDING * 2;
  const labelHeight = LABEL_FONT_SIZE + LABEL_PADDING * 2;

  return svg`
    <g class="edge ${edge.isActive ? "active" : ""}">
      <path
        class="edge-path"
        d="${edge.path}"
        fill="none"
        stroke="${edge.isActive ? "var(--viz-edge-active-stroke)" : "var(--viz-edge-stroke)"}"
        stroke-width="${edge.isActive ? 3 : 2}"
        marker-end="${edge.isActive ? "url(#arrowhead-active)" : "url(#arrowhead)"}"
      />
      <rect
        x="${edge.labelX - labelWidth / 2}"
        y="${edge.labelY - labelHeight / 2}"
        width="${labelWidth}"
        height="${labelHeight}"
        fill="white"
        stroke="${edge.isActive ? "var(--viz-edge-active-stroke)" : "var(--viz-edge-stroke)"}"
        stroke-width="1"
        rx="3"
      />
      <text
        x="${edge.labelX}"
        y="${edge.labelY}"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="${edge.isActive ? "var(--viz-edge-active-stroke)" : "var(--viz-text-secondary)"}"
        font-size="${LABEL_FONT_SIZE}"
        font-family="system-ui, sans-serif"
      >${labelText}</text>
    </g>
  `;
}
