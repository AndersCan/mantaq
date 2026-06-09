import {
  defineConfig,
  presetUno,
  presetIcons,
  presetWebFonts,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
    presetWebFonts({
      fonts: {
        mono: [
          "SF Mono",
          "Fira Code",
          "Fira Mono",
          "Menlo",
          "Consolas",
          "DejaVu Sans Mono",
          "monospace",
        ],
      },
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  shortcuts: {
    "viz-panel":
      "bg-[var(--viz-panel-bg,#ffffff)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-lg shadow-sm",
    "viz-btn":
      "flex items-center justify-center border-none bg-transparent cursor-pointer rounded transition-colors duration-150",
    "viz-input":
      "bg-[var(--viz-panel-bg,#ffffff)] border border-[var(--viz-panel-border,#e5e7eb)] rounded px-3 py-1.5 text-sm font-mono text-[var(--viz-text,#1f2937)] outline-none focus:ring-2 focus:ring-[var(--viz-accent,#6366f1)]",
    "viz-text": "text-[var(--viz-text,#1f2937)]",
    "viz-text-muted": "text-[var(--viz-text-muted,#6b7280)]",
    "viz-accent": "text-[var(--viz-accent,#6366f1)]",
    "viz-bg": "bg-[var(--viz-bg,#fafafa)]",
    "viz-node":
      "bg-[var(--viz-node-bg,#ffffff)] border border-[var(--viz-node-border,#d1d5db)] rounded-md",
  },
  theme: {
    colors: {
      viz: {
        bg: "var(--viz-bg,#fafafa)",
        border: "var(--viz-border,#e5e7eb)",
        "node-bg": "var(--viz-node-bg,#ffffff)",
        "node-active-bg": "var(--viz-node-active-bg,#dcfce7)",
        "node-border": "var(--viz-node-border,#d1d5db)",
        "node-active-border": "var(--viz-node-active-border,#22c55e)",
        "node-label": "var(--viz-node-label,#374151)",
        "edge-color": "var(--viz-edge-color,#9ca3af)",
        "edge-active": "var(--viz-edge-active,#3b82f6)",
        "edge-label": "var(--viz-edge-label,#6b7280)",
        text: "var(--viz-text,#1f2937)",
        "text-muted": "var(--viz-text-muted,#6b7280)",
        accent: "var(--viz-accent,#6366f1)",
        "error-text": "var(--viz-error-text,#dc2626)",
        "error-bg": "var(--viz-error-bg,#fef2f2)",
        "error-border": "var(--viz-error-border,#fecaca)",
        "context-bg": "var(--viz-context-bg,#f8fafc)",
        "context-border": "var(--viz-context-border,#e2e8f0)",
        "context-text": "var(--viz-context-text,#475569)",
        "panel-bg": "var(--viz-panel-bg,#ffffff)",
        "panel-border": "var(--viz-panel-border,#e5e7eb)",
      },
    },
    fontFamily: {
      mono: [
        "SF Mono",
        "Fira Code",
        "Fira Mono",
        "Menlo",
        "Consolas",
        "DejaVu Sans Mono",
        "monospace",
      ],
    },
  },
  content: {
    pipeline: {
      include: ["packages/visualizer/src/**/*.ts"],
    },
  },
});
