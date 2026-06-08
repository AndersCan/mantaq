const DEFAULT_STYLES = `
  :root {
    color-scheme: light dark;
    --viz-bg: light-dark(#fafafa, #111827);
    --viz-border: light-dark(#e5e7eb, #374151);
    --viz-node-bg: light-dark(#ffffff, #1f2937);
    --viz-node-active-bg: light-dark(#dcfce7, #064e3b);
    --viz-node-border: light-dark(#d1d5db, #4b5563);
    --viz-node-active-border: light-dark(#22c55e, #22c55e);
    --viz-node-label: light-dark(#374151, #e5e7eb);
    --viz-edge-color: light-dark(#9ca3af, #4b5563);
    --viz-edge-active: light-dark(#22c55e, #22c55e);
    --viz-edge-label: light-dark(#6b7280, #9ca3af);
    --viz-text: light-dark(#374151, #e5e7eb);
    --viz-text-muted: light-dark(#6b7280, #9ca3af);
    --viz-accent: light-dark(#6366f1, #818cf8);
    --viz-error-text: light-dark(#dc2626, #fca5a5);
    --viz-error-bg: light-dark(#fef2f2, #450a0a);
    --viz-error-border: light-dark(#fecaca, #7f1d1d);
  }
`;

let stylesInjected = false;

// Uses raw CSS strings instead of Lit's `css` template literal because this injects
// styles into document.head (not a shadow DOM), so Lit's CSSResult cannot be used here.
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
