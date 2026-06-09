import { html } from "lit";
import { render } from "lit/html.js";
import {
  $shortcuts,
  formatShortcutKey,
  groupShortcutsByCategory,
  type ShortcutDefinition,
} from "../shortcut-registry.ts";
import { atom } from "nanostores";

export const $shortcutOverlayVisible = atom(false);

const STYLES = `<style>
  :host { display: block; }
  @media (prefers-reduced-motion: reduce) {
    .overlay { transition: none; }
  }
</style>`;

export class ShortcutOverlay extends HTMLElement {
  _shadow: ShadowRoot;
  _unsubscribers: Array<() => void> = [];
  _visible = false;
  _shortcuts: readonly ShortcutDefinition[] = [];
  updateComplete = Promise.resolve();

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $shortcutOverlayVisible.subscribe((v) => {
        this._visible = v;
        this._requestRender();
      }),
      $shortcuts.subscribe((v) => {
        this._shortcuts = v;
        this._requestRender();
      }),
    );
    this._requestRender();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _close() {
    $shortcutOverlayVisible.set(false);
  }

  _handleBackdropClick = (e: Event) => {
    if ((e.target as HTMLElement).classList.contains("overlay")) {
      this._close();
    }
  };

  _handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this._visible) {
      e.preventDefault();
      e.stopPropagation();
      this._close();
    }
  };

  _requestRender() {
    let resolve: () => void;
    this.updateComplete = new Promise<void>((r) => {
      resolve = r;
    });

    const groups = groupShortcutsByCategory(this._shortcuts);

    const content = this._visible
      ? html`<div
          class="overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-[2px] opacity-0 pointer-events-none transition-opacity duration-150${this
            ._visible
            ? " open opacity-100 pointer-events-auto"
            : ""}"
          @click=${this._handleBackdropClick}
          @keydown=${this._handleKeyDown}
        >
          <div
            class="bg-[var(--viz-panel-bg,#ffffff)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-lg shadow-[0_4px_20px_rgba(0,0,0,.15)] font-mono text-[12px] text-[var(--viz-panel-text,#374151)] max-w-[500px] w-[90vw] max-h-[80vh] overflow-y-auto"
            role="dialog"
            aria-label="Keyboard shortcuts"
          >
            <div
              class="flex items-center justify-between px-4 py-3 border-b border-[var(--viz-panel-border,#e5e7eb)] sticky top-0 bg-[var(--viz-panel-bg,#ffffff)] z-1"
            >
              <span class="text-[14px] font-semibold text-[var(--viz-panel-title,#111827)]"
                >Keyboard Shortcuts</span
              >
              <button
                class="w-6 h-6 flex items-center justify-center border-none bg-transparent cursor-pointer rounded text-[14px] text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] close-btn"
                aria-label="Close"
                @click=${() => this._close()}
              >
                &times;
              </button>
            </div>
            ${[...groups.entries()].map(
              ([category, shortcuts]) => html`
                <div class="px-4 py-2">
                  <div
                    class="text-[11px] font-semibold text-[var(--viz-text-muted,#6b7280)] uppercase tracking-wider mb-[6px] pb-1 border-b border-[var(--viz-border,#e5e7eb)] category-title"
                  >
                    ${category}
                  </div>
                  ${shortcuts.map(
                    (s) => html`
                      <div class="flex items-center justify-between py-1 gap-2 shortcut-row">
                        <span class="text-[var(--viz-panel-text,#374151)] text-[12px]"
                          >${s.description}</span
                        >
                        <span class="flex gap-[3px] flex-shrink-0">
                          ${formatShortcutKey(s)
                            .split("+")
                            .map(
                              (part) =>
                                html`<kbd
                                  class="inline-block bg-[var(--viz-panel-item-bg,#f9fafb)] border border-[var(--viz-panel-border,#e5e7eb)] rounded-[3px] px-[6px] py-px font-mono text-[11px] text-[var(--viz-panel-text,#374151)] min-w-[18px] text-center leading-[1.6]"
                                  >${part}</kbd
                                >`,
                            )}
                        </span>
                      </div>
                    `,
                  )}
                </div>
              `,
            )}
          </div>
        </div>`
      : html``;

    render(html`${STYLES}${content}`, this._shadow);
    resolve!();
  }
}

customElements.define("shortcut-overlay", ShortcutOverlay);
