import { html } from "lit";
import { render } from "lit/html.js";
import {
  $selectedNodeId,
  $layout,
  $contextData,
  $timers,
  $graphData,
  $detailsPanelVisible,
  type TimerInfo,
} from "../graph-store.ts";
import type { LayoutNode } from "../layout.ts";
import type { GraphEdge } from "../graph.ts";

const PANEL_STYLES = `<style>
  :host { display: block; }
  .panel {
    position: absolute; top: 0; right: 0; bottom: 0;
    width: 320px; max-width: 90vw;
    background: var(--viz-panel-bg, #ffffff);
    border-left: 1px solid var(--viz-panel-border, #e5e7eb);
    box-shadow: -2px 0 8px rgba(0,0,0,.08);
    display: flex; flex-direction: column;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 12px; color: var(--viz-panel-text, #374151);
    z-index: 20;
    transform: translateX(100%);
    transition: transform 0.25s ease;
    overflow: hidden;
  }
  .panel.open { transform: translateX(0); }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--viz-panel-border, #e5e7eb);
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 14px; font-weight: 600;
    color: var(--viz-panel-title, #111827);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .close-btn {
    width: 24px; height: 24px; border: none; background: transparent;
    cursor: pointer; border-radius: 4px; font-size: 16px;
    color: var(--viz-text-muted, #6b7280);
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .close-btn:hover { background: var(--viz-border, #e5e7eb); }
  .panel-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
  .section { margin-bottom: 16px; }
  .section-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .05em; color: var(--viz-text-muted, #6b7280);
    margin-bottom: 6px;
  }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 500; margin-right: 4px; margin-bottom: 4px;
  }
  .badge-active { background: var(--viz-node-active-bg, #dcfce7); color: #166534; border: 1px solid var(--viz-node-active-border, #22c55e); }
  .badge-final { background: var(--viz-accent, #6366f1); color: #fff; }
  .badge-inactive { background: var(--viz-border, #e5e7eb); color: var(--viz-text-muted, #6b7280); }
  .context-block {
    background: var(--viz-context-bg, #f8fafc);
    border: 1px solid var(--viz-context-border, #e2e8f0);
    border-radius: 6px; padding: 8px 10px;
    font-size: 11px; color: var(--viz-context-text, #475569);
    white-space: pre-wrap; word-break: break-all;
    max-height: 200px; overflow-y: auto;
  }
  .transition-item {
    padding: 6px 8px; border-radius: 4px;
    border: 1px solid var(--viz-panel-border, #e5e7eb);
    margin-bottom: 4px;
    background: var(--viz-panel-item-bg, #fafafa);
  }
  .transition-event { font-weight: 600; color: var(--viz-text, #374151); }
  .transition-target { font-size: 11px; color: var(--viz-text-muted, #6b7280); }
  .guard-tag {
    display: inline-block; margin-top: 4px;
    padding: 1px 6px; border-radius: 3px; font-size: 10px;
    background: var(--viz-payload-guard-bg, #fef3c7);
    border: 1px solid var(--viz-payload-guard-border, #f59e0b);
    color: var(--viz-payload-guard-text, #92400e);
  }
  .action-tag {
    display: inline-block; margin-top: 4px;
    padding: 1px 6px; border-radius: 3px; font-size: 10px;
    background: var(--viz-payload-action-bg, #dbeafe);
    border: 1px solid var(--viz-payload-action-border, #3b82f6);
    color: var(--viz-payload-action-text, #1e40af);
  }
  .timer-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 4px;
    border: 1px solid var(--viz-timer-badge-border, #f59e0b);
    background: var(--viz-timer-badge-bg, #fef3c7);
    margin-bottom: 4px;
  }
  .timer-label { font-weight: 500; color: var(--viz-timer-badge-text, #92400e); }
  .timer-status { font-size: 10px; color: var(--viz-text-muted, #6b7280); }
  .empty { color: var(--viz-text-muted, #9ca3af); font-style: italic; font-size: 11px; }
</style>`;

export class NodeDetailsPanel extends HTMLElement {
  _shadow: ShadowRoot;
  _unsubscribers: Array<() => void> = [];
  _open = false;
  _selectedNodeId: string | null = null;
  _layoutNodes: LayoutNode[] = [];
  _graphEdges: GraphEdge[] = [];
  _contextData: Record<string, unknown> = {};
  _timers: TimerInfo[] = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $selectedNodeId.subscribe((v) => {
        const wasOpen = this._open;
        this._selectedNodeId = v;
        if (v) {
          this._open = true;
          $detailsPanelVisible.set(true);
        }
        this._renderPanel();
        if (v && !wasOpen) {
          requestAnimationFrame(() => {
            const closeBtn = this._shadow.querySelector(".close-btn") as HTMLElement;
            closeBtn?.focus();
          });
        }
      }),
      $layout.subscribe((v) => {
        this._layoutNodes = v?.nodes ?? [];
        this._renderPanel();
      }),
      $graphData.subscribe((v) => {
        this._graphEdges = v?.edges ?? [];
        this._renderPanel();
      }),
      $contextData.subscribe((v) => {
        this._contextData = v;
        this._renderPanel();
      }),
      $timers.subscribe((v) => {
        this._timers = [...v];
        this._renderPanel();
      }),
    );

    this._renderPanel();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _close() {
    this._open = false;
    $detailsPanelVisible.set(false);
    $selectedNodeId.set(null);
    this._renderPanel();
    const graph = document.querySelector("actor-graph") as HTMLElement & { _shadow?: ShadowRoot };
    if (graph?._shadow) {
      const container = graph._shadow.querySelector(".container") as HTMLElement;
      container?.focus();
    }
  }

  _handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this._close();
      return;
    }
    if (e.key === "Tab") {
      const focusable = this._shadow.querySelectorAll('button, [tabindex="0"]');
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  _selectedNode(): LayoutNode | undefined {
    return this._layoutNodes.find((n) => n.id === this._selectedNodeId);
  }

  _outgoingEdges(): GraphEdge[] {
    return this._graphEdges.filter((e) => e.source === this._selectedNodeId);
  }

  _nodeTimers(): TimerInfo[] {
    return this._timers.filter((t) => t.nodeId === this._selectedNodeId);
  }

  _contextForNode(): unknown {
    if (!this._selectedNodeId) return null;
    return this._contextData[this._selectedNodeId] ?? null;
  }

  _renderPanel() {
    try {
      const node = this._selectedNode();
      const open = this._open && !!node;
      const edges = this._outgoingEdges();
      const nodeTimers = this._nodeTimers();
      const ctx = this._contextForNode();

      const statusBadges = node
        ? html`<div style="margin-bottom:12px">
            ${node.isActive
              ? html`<span class="badge badge-active">active</span>`
              : html`<span class="badge badge-inactive">inactive</span>`}
            ${node.isFinal ? html`<span class="badge badge-final">final</span>` : ""}
          </div>`
        : "";

      const contextSection =
        ctx != null
          ? html`<div class="section">
              <div class="section-label">Context</div>
              <div class="context-block">${serializeContext(ctx)}</div>
            </div>`
          : "";

      const transitionSection =
        edges.length > 0
          ? html`<div class="section">
              <div class="section-label">Transitions (${edges.length})</div>
              ${edges.map(
                (e) =>
                  html`<div class="transition-item">
                    <div class="transition-event">${e.label}</div>
                    <div class="transition-target">&rarr; ${e.target}</div>
                    ${e.payload?.guard
                      ? html`<span class="guard-tag">guard: ${e.payload.guard}</span>`
                      : ""}
                    ${e.payload?.action
                      ? html`<span class="action-tag">${e.payload.action}</span>`
                      : ""}
                  </div>`,
              )}
            </div>`
          : html`<div class="section">
              <div class="section-label">Transitions</div>
              <div class="empty">No outgoing transitions</div>
            </div>`;

      const timerSection =
        nodeTimers.length > 0
          ? html`<div class="section">
              <div class="section-label">Timers (${nodeTimers.length})</div>
              ${nodeTimers.map(
                (t) =>
                  html`<div class="timer-item">
                    <span class="timer-label">${t.label}</span>
                    <span class="timer-status">${t.status}</span>
                  </div>`,
              )}
            </div>`
          : "";

      const body = node
        ? html`${statusBadges}${contextSection}${transitionSection}${timerSection}`
        : html`<div class="empty">Select a node to view details</div>`;

      render(
        html`${PANEL_STYLES}
          <div
            class="panel${open ? " open" : ""}"
            role="dialog"
            aria-label="Node details"
            aria-expanded="${open}"
            @keydown=${this._handleKeyDown}
          >
            <div class="panel-header">
              <span class="panel-title">${node?.label ?? "Node Details"}</span>
              <button class="close-btn" aria-label="Close panel" @click=${() => this._close()}>
                &times;
              </button>
            </div>
            <div class="panel-body">${body}</div>
          </div>`,
        this._shadow,
      );
    } catch {
      render(
        html`${PANEL_STYLES}
          <div
            class="panel${this._open ? " open" : ""}"
            role="dialog"
            aria-label="Node details"
            aria-expanded="${this._open}"
            @keydown=${this._handleKeyDown}
          >
            <div class="panel-header">
              <span class="panel-title">Error</span>
              <button class="close-btn" aria-label="Close panel" @click=${() => this._close()}>
                &times;
              </button>
            </div>
            <div class="panel-body">
              <div class="empty" style="color:var(--viz-error-text)">Failed to render panel</div>
            </div>
          </div>`,
        this._shadow,
      );
    }
  }
}

function serializeContext(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return escapeHtml(data);
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      },
      2,
    );
    return escapeHtml(json ?? "");
  } catch {
    return "[Unserializable]";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

customElements.define("node-details-panel", NodeDetailsPanel);
