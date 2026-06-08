import { css, type CSSResultGroup } from "lit";

export interface Theme {
  nodeBackground: string;
  nodeBorder: string;
  nodeActiveBackground: string;
  nodeActiveBorder: string;
  nodeActiveShadow: string;
  nodeSelectedBorder: string;
  nodeSelectedShadow: string;
  nodeFinalBorder: string;
  edgeStroke: string;
  edgeActiveStroke: string;
  edgeLabelColor: string;
  graphBackground: string;
  graphGridColor: string;
  textPrimary: string;
  textSecondary: string;
  controlBackground: string;
  controlBorder: string;
  controlHover: string;
  regionBackground: string;
  regionBorder: string;
}

export const theme: Theme = {
  nodeBackground: "#ffffff",
  nodeBorder: "#666666",
  nodeActiveBackground: "#E8F5E9",
  nodeActiveBorder: "#4CAF50",
  nodeActiveShadow: "rgba(76, 175, 80, 0.3)",
  nodeSelectedBorder: "#2196F3",
  nodeSelectedShadow: "rgba(33, 150, 243, 0.3)",
  nodeFinalBorder: "#333333",

  edgeStroke: "#999999",
  edgeActiveStroke: "#4CAF50",
  edgeLabelColor: "#666666",

  graphBackground: "#fafafa",
  graphGridColor: "#f0f0f0",

  textPrimary: "#333333",
  textSecondary: "#666666",

  controlBackground: "#ffffff",
  controlBorder: "#cccccc",
  controlHover: "#f0f0f0",

  regionBackground: "rgba(0, 0, 0, 0.02)",
  regionBorder: "#e0e0e0",
};

export const HOST_VARS = `
  --viz-node-bg: ${theme.nodeBackground};
  --viz-node-border: ${theme.nodeBorder};
  --viz-node-active-bg: ${theme.nodeActiveBackground};
  --viz-node-active-border: ${theme.nodeActiveBorder};
  --viz-node-selected-border: ${theme.nodeSelectedBorder};
  --viz-edge-stroke: ${theme.edgeStroke};
  --viz-edge-active-stroke: ${theme.edgeActiveStroke};
  --viz-graph-bg: ${theme.graphBackground};
  --viz-text-primary: ${theme.textPrimary};
  --viz-text-secondary: ${theme.textSecondary};
`;

export const visualizerStyles: CSSResultGroup = css`
  :host {
    --viz-node-bg: #ffffff;
    --viz-node-border: #666666;
    --viz-node-active-bg: #e8f5e9;
    --viz-node-active-border: #4caf50;
    --viz-node-selected-border: #2196f3;
    --viz-edge-stroke: #999999;
    --viz-edge-active-stroke: #4caf50;
    --viz-graph-bg: #fafafa;
    --viz-text-primary: #333333;
    --viz-text-secondary: #666666;
  }
`;

export const stateNodeStyles: CSSResultGroup = css`
  .node {
    padding: 8px 16px;
    border: 2px solid var(--viz-node-border);
    border-radius: 8px;
    background: var(--viz-node-bg);
    text-align: center;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 14px;
    transition: all 0.2s ease;
    min-width: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    box-sizing: border-box;
  }

  .node:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .node.active {
    border-color: var(--viz-node-active-border);
    background: var(--viz-node-active-bg);
    box-shadow: 0 0 8px var(--viz-node-active-shadow, rgba(76, 175, 80, 0.3));
  }

  .node.final {
    border-width: 4px;
    border-style: double;
  }

  .node.selected {
    border-color: var(--viz-node-selected-border);
    box-shadow: 0 0 0 3px var(--viz-node-selected-shadow, rgba(33, 150, 243, 0.3));
  }

  .label {
    font-weight: 500;
    color: var(--viz-text-primary);
    white-space: nowrap;
    pointer-events: none;
  }
`;

export const edgeStyles: CSSResultGroup = css`
  .edge path {
    transition:
      stroke 0.2s ease,
      stroke-width 0.2s ease;
  }

  .edge.active path {
    stroke: var(--viz-edge-active-stroke);
    stroke-width: 3;
  }

  .edge text {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    fill: var(--viz-text-secondary);
    font-size: 12px;
  }
`;

const RAW_DEFAULT_CSS = `
  :host {
    ${HOST_VARS}
  }
  .node {
    padding: 8px 16px;
    border: 2px solid var(--viz-node-border);
    border-radius: 8px;
    background: var(--viz-node-bg);
    text-align: center;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    transition: all 0.2s ease;
    min-width: 80px;
    cursor: pointer;
    user-select: none;
  }
  .node:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
  .node.active {
    border-color: var(--viz-node-active-border);
    background: var(--viz-node-active-bg);
    box-shadow: 0 0 8px var(--viz-node-active-shadow, rgba(76, 175, 80, 0.3));
  }
  .node.final { border-width: 4px; border-style: double; }
  .node.selected {
    border-color: var(--viz-node-selected-border);
    box-shadow: 0 0 0 3px var(--viz-node-selected-shadow, rgba(33, 150, 243, 0.3));
  }
  .label { font-weight: 500; color: var(--viz-text-primary); white-space: nowrap; }
  .edge path { transition: stroke 0.2s ease, stroke-width 0.2s ease; }
  .edge.active path { stroke: var(--viz-edge-active-stroke); stroke-width: 3; }
  .edge text { font-family: system-ui, -apple-system, sans-serif; fill: var(--viz-text-secondary); font-size: 12px; }
  .controls { position: absolute; bottom: 12px; right: 12px; display: flex; flex-direction: column; gap: 4px; z-index: 10; }
  .controls button { width: 32px; height: 32px; border: 1px solid var(--viz-control-border); background: var(--viz-control-background); border-radius: 4px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
  .controls button:hover { background: var(--viz-control-hover); }
  .controls button:active { transform: scale(0.95); }
`;

export function applyDefaultStyles(): void {
  if (typeof document !== "undefined") {
    const existing = document.getElementById("mantaq-visualizer-styles");
    if (!existing) {
      const style = document.createElement("style");
      style.id = "mantaq-visualizer-styles";
      style.textContent = RAW_DEFAULT_CSS;
      document.head.appendChild(style);
    }
  }
}
