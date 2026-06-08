const DEFAULT_STYLES = `
  :root {
    --viz-bg: #fafafa;
    --viz-border: #e5e7eb;
    --viz-node-bg: #ffffff;
    --viz-node-active-bg: #dcfce7;
    --viz-node-border: #d1d5db;
    --viz-node-active-border: #22c55e;
    --viz-node-label: #374151;
    --viz-edge-color: #9ca3af;
    --viz-edge-active: #22c55e;
    --viz-edge-label: #6b7280;
    --viz-text: #374151;
    --viz-text-muted: #6b7280;
    --viz-accent: #6366f1;
    --viz-error-text: #dc2626;
    --viz-error-bg: #fef2f2;
    --viz-error-border: #fecaca;
  }

  [data-theme="dark"] {
    --viz-bg: #111827;
    --viz-border: #374151;
    --viz-node-bg: #1f2937;
    --viz-node-active-bg: #064e3b;
    --viz-node-border: #4b5563;
    --viz-node-active-border: #22c55e;
    --viz-node-label: #e5e7eb;
    --viz-edge-color: #4b5563;
    --viz-edge-active: #22c55e;
    --viz-edge-label: #9ca3af;
    --viz-text: #e5e7eb;
    --viz-text-muted: #9ca3af;
    --viz-accent: #818cf8;
    --viz-error-text: #fca5a5;
    --viz-error-bg: #450a0a;
    --viz-error-border: #7f1d1d;
  }
`;

let stylesInjected = false;

export function applyDefaultStyles(): void {
  if (stylesInjected) return;
  if (typeof document === "undefined") return;

  const style = document.createElement("style");
  style.id = "mantaq-visualizer-defaults";
  style.textContent = DEFAULT_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function removeDefaultStyles(): void {
  const style = document.getElementById("mantaq-visualizer-defaults");
  style?.remove();
  stylesInjected = false;
}
