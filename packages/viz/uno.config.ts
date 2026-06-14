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
    "viz-dark": "bg-slate-800 text-slate-300 font-mono",
    "viz-darker": "bg-slate-900 text-slate-300 font-mono",
    "viz-card": "px-3 py-2 bg-slate-800 border-b border-slate-700",
    "viz-toolbar":
      "flex items-center justify-end px-4 py-2 bg-slate-900 border-b border-slate-800 gap-2 relative",
    "viz-gear":
      "text-base px-2.5 h-7 inline-flex items-center justify-center border border-slate-600 rounded bg-transparent text-slate-400 cursor-pointer appearance-none hover:bg-slate-700 hover:text-slate-200",
    "viz-gear-open": "bg-slate-700 border-blue-500 text-blue-500",
    "viz-settings":
      "absolute top-full right-0 mt-1 bg-slate-800 border border-slate-600 rounded-md p-3 z-10 min-w-45 flex flex-col gap-2.5",
    "viz-settings-label": "flex items-center justify-between text-sm text-slate-400 gap-2",
    "viz-settings-select":
      "font-inherit text-sm px-1.5 py-0.5 border border-slate-600 rounded bg-slate-900 text-slate-200",
    "viz-event-btn":
      "font-inherit text-sm px-2.5 h-7 inline-flex items-center rounded cursor-pointer whitespace-nowrap font-600 appearance-none",
    "viz-event-primary": "bg-blue-700 border border-blue-500 text-slate-200 hover:bg-blue-600",
    "viz-event-edge":
      "bg-transparent border border-slate-600 text-slate-400 hover:bg-slate-800 hover:text-slate-200",
    "viz-event-internal":
      "bg-transparent border border-slate-700 text-slate-500 cursor-default font-400 text-xs",
    "viz-zoom-btn":
      "font-inherit text-base w-8 h-7.5 inline-flex items-center justify-center border-none bg-transparent text-slate-200 cursor-pointer p-0 hover:bg-slate-700 active:bg-slate-600",
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
      include: ["packages/viz/src/**/*.ts"],
    },
  },
  safelist: [
    "w-2",
    "h-2",
    "rounded-full",
    "flex-shrink-0",
    "bg-green-500",
    "bg-slate-400",
    "bg-transparent",
    "bg-red-500",
    "border-2",
    "border-slate-500",
    "shadow-[0_0_4px_rgba(34,197,94,0.5)]",
    "shadow-[0_0_4px_rgba(239,68,68,0.5)]",
    "viz-event-btn",
    "viz-event-primary",
    "viz-event-edge",
    "viz-event-internal",
  ],
});
