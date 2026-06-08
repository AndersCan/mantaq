import { svg } from "lit-html";
import type { ComputedEdge } from "../layout.ts";

export function renderEdge(edge: ComputedEdge) {
  return svg`
    <g class="edge ${edge.isActive ? "active" : ""}">
      <path
        class="edge-path"
        d="${edge.path}"
        fill="none"
        stroke="${edge.isActive ? "#4CAF50" : "#999"}"
        stroke-width="${edge.isActive ? 3 : 2}"
        marker-end="url(#arrowhead)"
      />
      <text
        x="${edge.labelX}"
        y="${edge.labelY}"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="#666"
        font-size="12"
        font-family="system-ui, sans-serif"
      >${edge.label}</text>
    </g>
  `;
}
