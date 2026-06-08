import { css, unsafeCSS, type CSSResultGroup } from "lit";

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

export const darkTheme: Theme = {
  nodeBackground: "#1e1e1e",
  nodeBorder: "#555555",
  nodeActiveBackground: "#1b3a1b",
  nodeActiveBorder: "#66BB6A",
  nodeActiveShadow: "rgba(102, 187, 106, 0.3)",
  nodeSelectedBorder: "#42A5F5",
  nodeSelectedShadow: "rgba(66, 165, 245, 0.3)",
  nodeFinalBorder: "#aaaaaa",

  edgeStroke: "#777777",
  edgeActiveStroke: "#66BB6A",
  edgeLabelColor: "#aaaaaa",

  graphBackground: "#121212",
  graphGridColor: "#1e1e1e",

  textPrimary: "#e0e0e0",
  textSecondary: "#aaaaaa",

  controlBackground: "#2d2d2d",
  controlBorder: "#444444",
  controlHover: "#3a3a3a",

  regionBackground: "rgba(255, 255, 255, 0.03)",
  regionBorder: "#333333",
};

export function HOST_VARS(t: Theme = theme): string {
  return themeToVars(t);
}

export const visualizerStyles: CSSResultGroup = unsafeCSS(`
  :host {
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
    --viz-region-border: ${theme.regionBorder};
  }
`);

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
    ${HOST_VARS()}
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

function themeToVars(t: Theme): string {
  return `
    --viz-node-bg: ${t.nodeBackground};
    --viz-node-border: ${t.nodeBorder};
    --viz-node-active-bg: ${t.nodeActiveBackground};
    --viz-node-active-border: ${t.nodeActiveBorder};
    --viz-node-active-shadow: ${t.nodeActiveShadow};
    --viz-node-selected-border: ${t.nodeSelectedBorder};
    --viz-node-selected-shadow: ${t.nodeSelectedShadow};
    --viz-edge-stroke: ${t.edgeStroke};
    --viz-edge-active-stroke: ${t.edgeActiveStroke};
    --viz-text-primary: ${t.textPrimary};
    --viz-text-secondary: ${t.textSecondary};
    --viz-control-background: ${t.controlBackground};
    --viz-control-border: ${t.controlBorder};
    --viz-control-hover: ${t.controlHover};
    --viz-graph-bg: ${t.graphBackground};
    --viz-region-border: ${t.regionBorder};
  `;
}

export function applyDarkTheme(): void {
  if (typeof document !== "undefined") {
    let el = document.getElementById("mantaq-dark-theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "mantaq-dark-theme";
      document.head.appendChild(el);
    }
    el.textContent = `actor-graph { ${themeToVars(darkTheme)} }`;
  }
}

export function removeDarkTheme(): void {
  if (typeof document !== "undefined") {
    const el = document.getElementById("mantaq-dark-theme");
    if (el) el.remove();
  }
}
