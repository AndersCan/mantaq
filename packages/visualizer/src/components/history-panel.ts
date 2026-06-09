import { html } from "lit";
import { render } from "lit/html.js";
import {
  $history,
  $historyReplayIndex,
  clearHistory,
  exportHistory,
  setHistoryReplayIndex,
  type HistoryEntry,
} from "../graph-store.ts";

const STYLES = `<style>
  :host { display: block; }
</style>`;

function shortName(fullPath: string): string {
  return fullPath.split(".").pop() ?? fullPath;
}

const MAX_RENDERED_ENTRIES = 50;

export class HistoryPanelComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _history: readonly HistoryEntry[] = [];
  _replayIndex = -1;
  _unsubscribers: Array<() => void> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $history.subscribe((v) => {
        this._history = v;
        this._render();
      }),
    );
    this._unsubscribers.push(
      $historyReplayIndex.subscribe((v) => {
        this._replayIndex = v;
        this._render();
      }),
    );
    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _handleEntryClick(index: number) {
    setHistoryReplayIndex(index);
  }

  _handlePrev() {
    setHistoryReplayIndex(this._replayIndex - 1);
  }

  _handleNext() {
    setHistoryReplayIndex(this._replayIndex + 1);
  }

  _handleClear() {
    clearHistory();
  }

  _handleExport() {
    const json = exportHistory();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _render() {
    const history = this._history;
    const replayIndex = this._replayIndex;
    const count = history.length;
    const startIndex = Math.max(0, count - MAX_RENDERED_ENTRIES);
    const visibleHistory = startIndex > 0 ? history.slice(startIndex) : history;

    const listHtml =
      count === 0
        ? html`<div
            class="empty px-2 py-3 text-center text-[var(--viz-text-muted,#9ca3af)] text-[10px]"
          >
            No transitions recorded
          </div>`
        : html`<div
            class="overflow-y-auto flex-1 py-1 max-h-[240px]"
            role="listbox"
            aria-label="Transition history entries"
          >
            ${startIndex > 0
              ? html`<div
                  class="flex items-center px-2 py-[3px] gap-[6px] text-[var(--viz-text-muted,#9ca3af)] italic cursor-default"
                >
                  ... ${startIndex} earlier entries
                </div>`
              : ""}
            ${visibleHistory.map((entry, i) => {
              const absIndex = startIndex + i;
              return html`
                <div
                  class="history-entry flex items-center px-2 py-[3px] gap-[6px] cursor-pointer transition-colors duration-100 hover:bg-[var(--viz-border,#e5e7eb)]${absIndex ===
                  replayIndex
                    ? " active bg-[var(--viz-node-active-bg,#dcfce7)]"
                    : ""}"
                  role="option"
                  aria-selected="${absIndex === replayIndex}"
                  @click=${() => this._handleEntryClick(absIndex)}
                >
                  <span
                    class="text-[var(--viz-text-muted,#9ca3af)] min-w-[20px] text-right text-[10px]"
                    >${absIndex + 1}</span
                  >
                  <span class="text-[var(--viz-accent,#6366f1)] text-[10px]">→</span>
                  <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span class="text-[var(--viz-text-muted,#9ca3af)]"
                      >${shortName(entry.fromState)}</span
                    >
                    →
                    <span class="text-[var(--viz-text,#374151)] font-semibold"
                      >${shortName(entry.toState)}</span
                    >
                  </span>
                </div>
              `;
            })}
          </div>`;

    const currentEntry = replayIndex >= 0 && replayIndex < count ? history[replayIndex] : null;
    const replayInfoHtml = currentEntry
      ? html`<div
          class="replay-info px-2 py-1 text-[10px] text-[var(--viz-text-muted,#6b7280)] border-t border-[var(--viz-border,#e5e7eb)] bg-[var(--viz-context-bg,#f8fafc)]"
        >
          Step ${replayIndex + 1}:
          <span class="text-[var(--viz-error-text,#dc2626)]"
            >${shortName(currentEntry.fromState)}</span
          >
          →
          <span class="text-[var(--viz-node-active-border,#22c55e)] font-semibold"
            >${shortName(currentEntry.toState)}</span
          >
        </div>`
      : "";

    const replayHtml = html`
      <div
        class="replay-controls flex items-center justify-center gap-1 px-2 py-[6px] border-t border-[var(--viz-border,#e5e7eb)]"
      >
        <button
          class="w-6 h-6 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-[3px] text-[12px] text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] disabled:opacity-[0.3] disabled:cursor-default"
          aria-label="Previous step (shortcut: [)"
          ?disabled=${replayIndex <= 0}
          @click=${() => this._handlePrev()}
        >
          ◀
        </button>
        <span
          class="replay-index text-[10px] text-[var(--viz-text-muted,#9ca3af)] min-w-[40px] text-center"
          >${replayIndex >= 0 ? replayIndex + 1 : "\u2013"} / ${count}</span
        >
        <button
          class="w-6 h-6 flex items-center justify-center border-none bg-transparent cursor-pointer rounded-[3px] text-[12px] text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] disabled:opacity-[0.3] disabled:cursor-default"
          aria-label="Next step (shortcut: ])"
          ?disabled=${replayIndex >= count - 1}
          @click=${() => this._handleNext()}
        >
          ▶
        </button>
      </div>
      ${replayInfoHtml}
    `;

    render(
      html`${STYLES}
        <div
          class="bg-[var(--viz-node-bg,#ffffff)] border border-[var(--viz-border,#e5e7eb)] rounded-md shadow-sm font-mono text-[11px] text-[var(--viz-text,#374151)] max-h-[300px] overflow-hidden flex flex-col w-[280px]"
          role="region"
          aria-label="Transition history"
        >
          <div
            class="panel-header flex items-center justify-between px-2 py-[6px] border-b border-[var(--viz-border,#e5e7eb)] text-[11px] font-semibold text-[var(--viz-text-muted,#6b7280)]"
          >
            <span>History (${count})</span>
            <div class="flex gap-1">
              <button
                class="w-[22px] h-[22px] flex items-center justify-center border-none bg-transparent cursor-pointer rounded-[3px] text-[10px] text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)]"
                aria-label="Export history"
                title="Export JSON"
                @click=${() => this._handleExport()}
              >
                ⬇
              </button>
              <button
                class="w-[22px] h-[22px] flex items-center justify-center border-none bg-transparent cursor-pointer rounded-[3px] text-[10px] text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)]"
                aria-label="Clear history"
                title="Clear"
                @click=${() => this._handleClear()}
              >
                ✕
              </button>
            </div>
          </div>
          ${listHtml} ${count > 0 ? replayHtml : ""}
        </div>`,
      this._shadow,
    );
  }
}

customElements.define("history-panel", HistoryPanelComponent);
