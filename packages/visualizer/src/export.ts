import { atom } from "nanostores";
import {
  $layout,
  $zoom,
  $pan,
  $graphData,
  $contextData,
  $history,
  $selectedNodeId,
  setZoom,
} from "./graph-store.ts";
import type { LayoutResult } from "./layout.ts";

export interface ExportOptions {
  format: "svg" | "png";
  scale: number;
  background: "white" | "transparent" | "current";
  padding: number;
}

const DEFAULT_OPTIONS: ExportOptions = {
  format: "svg",
  scale: 2,
  background: "white",
  padding: 40,
};

function getThemeColors(): Record<string, string> {
  if (typeof document === "undefined") {
    return {
      bg: "#fafafa",
      nodeBg: "#ffffff",
      nodeBorder: "#d1d5db",
      nodeActiveBorder: "#22c55e",
      nodeLabel: "#374151",
      edgeColor: "#9ca3af",
      edgeActive: "#22c55e",
      edgeLabel: "#6b7280",
      accent: "#6366f1",
    };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue("--viz-bg").trim() || "#fafafa",
    nodeBg: style.getPropertyValue("--viz-node-bg").trim() || "#ffffff",
    nodeBorder: style.getPropertyValue("--viz-node-border").trim() || "#d1d5db",
    nodeActiveBorder: style.getPropertyValue("--viz-node-active-border").trim() || "#22c55e",
    nodeLabel: style.getPropertyValue("--viz-node-label").trim() || "#374151",
    edgeColor: style.getPropertyValue("--viz-edge-color").trim() || "#9ca3af",
    edgeActive: style.getPropertyValue("--viz-edge-active").trim() || "#22c55e",
    edgeLabel: style.getPropertyValue("--viz-edge-label").trim() || "#6b7280",
    accent: style.getPropertyValue("--viz-accent").trim() || "#6366f1",
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSvgString(layout: LayoutResult, options: Partial<ExportOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const colors = getThemeColors();
  const w = layout.width + opts.padding * 2;
  const h = layout.height + opts.padding * 2;

  const bgRect =
    opts.background === "transparent"
      ? ""
      : `<rect width="${w}" height="${h}" fill="${opts.background === "white" ? "#ffffff" : colors.bg}" />`;

  const edges = layout.edges
    .map((e) => {
      const color = e.isActive ? colors.edgeActive : colors.edgeColor;
      const labelColor = colors.edgeLabel;
      return `<g>
        <path d="${e.path}" fill="none" stroke="${color}" stroke-width="2" transform="translate(${opts.padding},${opts.padding})" />
        <text x="${e.labelX + opts.padding}" y="${e.labelY + opts.padding}" text-anchor="middle" font-family="monospace" font-size="11" fill="${labelColor}">${escapeXml(e.label)}</text>
      </g>`;
    })
    .join("\n    ");

  const nodes = layout.nodes
    .map((n) => {
      const borderColor = n.isActive ? colors.nodeActiveBorder : colors.nodeBorder;
      const bgFill = n.isActive ? colors.nodeActiveBorder + "22" : colors.nodeBg;
      const x = n.x + opts.padding;
      const y = n.y + opts.padding;
      return `<g>
        <rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="6" fill="${bgFill}" stroke="${borderColor}" stroke-width="2" />
        <text x="${x + n.width / 2}" y="${y + n.height / 2 + 5}" text-anchor="middle" font-family="monospace" font-size="13" fill="${colors.nodeLabel}">${escapeXml(n.label)}</text>
      </g>`;
    })
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${bgRect}
  <g>
    ${edges}
  </g>
  <g>
    ${nodes}
  </g>
</svg>`;
}

export function exportAsSvg(options: Partial<ExportOptions> = {}): boolean {
  const layout = $layout.get();
  if (!layout) return false;

  const svg = buildSvgString(layout, options);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mantaq-graph.svg";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

export function exportAsPng(options: Partial<ExportOptions> = {}): Promise<boolean> {
  const layout = $layout.get();
  if (!layout) return Promise.resolve(false);

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const svg = buildSvgString(layout, options);
  const w = (layout.width + opts.padding * 2) * opts.scale;
  const h = (layout.height + opts.padding * 2) * opts.scale;

  const img = new Image();
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  return new Promise<boolean>((resolve) => {
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(false);
        return;
      }
      ctx.scale(opts.scale, opts.scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(false);
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = "mantaq-graph.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
        resolve(true);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

export interface GraphState {
  nodes: Array<{ id: string; label: string; isActive: boolean; isFinal: boolean }>;
  edges: Array<{ id: string; source: string; target: string; label: string; isActive: boolean }>;
  selectedNodeId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  history: Array<{ timestamp: number; fromState: string; toState: string; event: string }>;
  context: Record<string, unknown>;
}

export function getGraphState(): GraphState | null {
  const layout = $layout.get();
  const graph = $graphData.get();
  if (!layout || !graph) return null;

  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      isActive: n.isActive,
      isFinal: n.isFinal,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      isActive: e.isActive,
    })),
    selectedNodeId: $selectedNodeId.get(),
    zoom: $zoom.get(),
    pan: { ...$pan.get() },
    history: $history.get(),
    context: $contextData.get(),
  };
}

export async function copyGraphState(): Promise<boolean> {
  const state = getGraphState();
  if (!state) return false;

  const json = JSON.stringify(state, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = json;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }
}

export function shareViaUrl(): string | null {
  const state = getGraphState();
  if (!state) return null;

  const compact = {
    n: state.nodes.map((n) => n.id),
    s: state.selectedNodeId,
    z: Math.round(state.zoom * 100) / 100,
    p: [Math.round(state.pan.x), Math.round(state.pan.y)],
  };

  const encoded = btoa(JSON.stringify(compact));
  const url = new URL(window.location.href);
  url.searchParams.set("graph", encoded);
  return url.toString();
}

export function importFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const graphParam = params.get("graph");
  if (!graphParam) return false;

  try {
    const decoded = JSON.parse(atob(graphParam));
    if (decoded.s) $selectedNodeId.set(decoded.s);
    if (typeof decoded.z === "number") {
      setZoom(decoded.z);
    }
    if (decoded.p && Array.isArray(decoded.p) && decoded.p.length === 2) {
      $pan.set({ x: decoded.p[0], y: decoded.p[1] });
    }
    return true;
  } catch {
    return false;
  }
}

export const $exportMenuVisible = atom(false);
