import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { atom } from "nanostores";
import {
  $shortcuts,
  updateShortcut,
  resetShortcuts,
  formatShortcutKey,
  groupShortcutsByCategory,
  type ShortcutDefinition,
} from "../shortcut-registry.ts";

export const $shortcutEditorVisible = atom(false);
export const $editingShortcutId = atom<string | null>(null);
export const $listeningForKey = atom(false);

export function openShortcutEditor(): void {
  $shortcutEditorVisible.set(true);
}

export function closeShortcutEditor(): void {
  $shortcutEditorVisible.set(false);
  $editingShortcutId.set(null);
  $listeningForKey.set(false);
}

export function startEditingShortcut(id: string): void {
  $editingShortcutId.set(id);
  $listeningForKey.set(true);
}

export function stopEditing(): void {
  $editingShortcutId.set(null);
  $listeningForKey.set(false);
}

export function captureKey(e: KeyboardEvent): void {
  const id = $editingShortcutId.get();
  if (!id) return;

  e.preventDefault();
  e.stopPropagation();

  if (e.key === "Escape") {
    stopEditing();
    return;
  }

  updateShortcut(id, {
    key: e.key,
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  });
  stopEditing();
}

const STYLES = `<style>
  :host { display: block; }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.2); }
    50% { box-shadow: 0 0 0 4px rgba(99,102,241,0.1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .editor-backdrop { transition: none !important; }
    .shortcut-key-btn.editing { animation: none !important; }
  }
</style>`;

export class ShortcutEditor extends HTMLElement {
  _shadow: ShadowRoot;
  _unsubscribers: Array<() => void> = [];
  _visible = false;
  _shortcuts: readonly ShortcutDefinition[] = [];
  _editingId: string | null = null;
  _listening = false;
  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $shortcutEditorVisible.subscribe((v) => {
        this._visible = v;
        if (v) this._requestRender();
        this._requestRender();
      }),
      $shortcuts.subscribe((v) => {
        this._shortcuts = v;
        this._requestRender();
      }),
      $editingShortcutId.subscribe((v) => {
        this._editingId = v;
        this._requestRender();
      }),
      $listeningForKey.subscribe((v) => {
        this._listening = v;
        this._requestRender();
      }),
    );
    this._requestRender();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _handleBackdropClick = (e: Event) => {
    if ((e.target as HTMLElement).classList.contains("editor-backdrop")) {
      closeShortcutEditor();
    }
  };

  _handleKeyDown = (e: KeyboardEvent) => {
    if (this._listening) {
      captureKey(e);
      return;
    }
    if (e.key === "Escape" && this._visible) {
      e.preventDefault();
      e.stopPropagation();
      closeShortcutEditor();
    }
  };

  _handleKeyClick(id: string) {
    if (this._editingId === id) {
      stopEditing();
    } else {
      startEditingShortcut(id);
    }
  }

  _handleReset() {
    resetShortcuts();
  }

  _requestRender() {
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });

    const groups = groupShortcutsByCategory(this._shortcuts);

    const content = this._visible
      ? html`<div
          class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-[2px] opacity-100 pointer-events-auto transition-opacity duration-150 editor-backdrop"
          @click=${this._handleBackdropClick}
          @keydown=${this._handleKeyDown}
        >
          <div
            class="bg-[var(--viz-panel-bg,#ffffff)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-lg shadow-[0_4px_20px_rgba(0,0,0,.15)] font-mono text-[12px] text-[var(--viz-panel-text,#374151)] max-w-[480px] w-[90vw] max-h-[80vh] overflow-y-auto editor-panel"
            role="dialog"
            aria-label="Customize shortcuts"
          >
            <div
              class="flex items-center justify-between px-4 py-3 border-b border-[var(--viz-panel-border,#e5e7eb)] sticky top-0 bg-[var(--viz-panel-bg,#ffffff)] z-[1] editor-header"
            >
              <span class="text-[14px] font-semibold text-[var(--viz-panel-title,#111827)]"
                >Customize Shortcuts</span
              >
              <div class="flex gap-1.5 header-actions">
                <button
                  class="px-2.5 py-1 border border-[var(--viz-error-border,#fecaca)] bg-[var(--viz-panel-item-bg,#f9fafb)] text-[var(--viz-error-text,#dc2626)] rounded cursor-pointer font-mono text-[11px] transition-colors duration-150 hover:bg-[var(--viz-error-bg,#fef2f2)] btn btn-danger"
                  @click=${() => this._handleReset()}
                >
                  Reset
                </button>
                <button
                  class="w-6 h-6 flex items-center justify-center border-none bg-transparent cursor-pointer rounded text-[14px] text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] close-btn"
                  aria-label="Close"
                  @click=${() => closeShortcutEditor()}
                >
                  &times;
                </button>
              </div>
            </div>
            ${[...groups.entries()].map(
              ([category, shortcuts]) => html`
                <div class="px-4 py-2 category-section">
                  <div
                    class="text-[11px] font-semibold text-[var(--viz-text-muted,#6b7280)] uppercase tracking-wider mb-1.5 pb-1 border-b border-[var(--viz-panel-border,#e5e7eb)] category-title"
                  >
                    ${category}
                  </div>
                  ${shortcuts.map(
                    (s) => html`
                      <div class="flex items-center justify-between py-1 gap-2 shortcut-row">
                        <span
                          class="flex-1 text-[var(--viz-panel-text,#374151)] text-[12px] shortcut-desc"
                          >${s.description}</span
                        >
                        <button
                          class="inline-flex items-center gap-[3px] px-2 py-0.5 bg-[var(--viz-panel-item-bg,#f9fafb)] border border-[var(--viz-panel-border,#e5e7eb)] rounded cursor-pointer font-mono text-[11px] text-[var(--viz-panel-text,#374151)] transition-all duration-150 min-w-[60px] justify-center hover:border-[var(--viz-accent,#6366f1)] shortcut-key-btn${this
                            ._editingId === s.id
                            ? " editing border-[var(--viz-accent,#6366f1)] bg-[var(--viz-node-active-bg,#dcfce7)] animate-[pulse_1s_ease-in-out_infinite]"
                            : ""}"
                          @click=${() => this._handleKeyClick(s.id)}
                          aria-label="Remap ${s.description}"
                        >
                          ${this._editingId === s.id && this._listening
                            ? "Press key..."
                            : formatShortcutKey(s)}
                        </button>
                      </div>
                    `,
                  )}
                </div>
              `,
            )}
            <div
              class="px-4 py-2 border-t border-[var(--viz-panel-border,#e5e7eb)] flex justify-end gap-1.5 footer"
            >
              <button
                class="px-2.5 py-1 border border-[var(--viz-panel-border,#e5e7eb)] bg-[var(--viz-panel-item-bg,#f9fafb)] text-[var(--viz-panel-text,#374151)] rounded cursor-pointer font-mono text-[11px] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] btn"
                @click=${() => closeShortcutEditor()}
              >
                Done
              </button>
            </div>
          </div>
        </div>`
      : html``;

    render(html`${unsafeHTML(STYLES)}${content}`, this._shadow);
    resolve!();
  }
}

customElements.define("shortcut-editor", ShortcutEditor);
