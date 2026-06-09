import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  $exportMenuVisible,
  exportAsSvg,
  exportAsPng,
  copyGraphState,
  shareViaUrl,
  type ExportOptions,
} from "../export.ts";

const STYLES = `<style>
  :host { display: block; position: relative; }
</style>`;

export class ExportMenuComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _visible = false;
  _toast = "";
  _toastTimer: ReturnType<typeof setTimeout> | null = null;
  _unsubscribers: Array<() => void> = [];
  _showOptions = false;
  _options: ExportOptions = {
    format: "svg",
    scale: 2,
    background: "white",
    padding: 40,
  };

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $exportMenuVisible.subscribe((v) => {
        this._visible = v;
        if (!v) this._showOptions = false;
        this._render();
      }),
    );
    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
    if (this._toastTimer) clearTimeout(this._toastTimer);
  }

  _showToast(msg: string) {
    this._toast = msg;
    this._render();
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = "";
      this._render();
    }, 2000);
  }

  _close() {
    $exportMenuVisible.set(false);
    this._showOptions = false;
  }

  async _handleExportWithFormat(format: "svg" | "png") {
    this._close();
    const opts = { ...this._options, format };
    if (format === "svg") {
      const ok = exportAsSvg(opts);
      this._showToast(ok ? "SVG exported" : "No graph to export");
    } else {
      const ok = await exportAsPng(opts);
      this._showToast(ok ? "PNG exported" : "Export failed");
    }
  }

  async _handleCopyJson() {
    this._close();
    const ok = await copyGraphState();
    this._showToast(ok ? "Copied to clipboard" : "Copy failed");
  }

  _handleShareUrl() {
    this._close();
    const url = shareViaUrl();
    if (url) {
      navigator.clipboard.writeText(url).then(
        () => this._showToast("Share URL copied"),
        () => this._showToast("URL generated"),
      );
    } else {
      this._showToast("No graph to share");
    }
  }

  _handleOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) this._close();
  };

  _updateOption(key: keyof ExportOptions, value: string | number) {
    this._options = { ...this._options, [key]: value };
    this._render();
  }

  _renderOptionsPanel() {
    return html`<div class="p-2 px-3 options-panel">
      <div
        class="font-mono text-[11px] text-[var(--viz-text-muted,#6b7280)] mb-2 uppercase tracking-[.5px]"
      >
        Export Options
      </div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono text-[11px] text-[var(--viz-node-label,#374151)]">Format</span>
        <select
          class="font-mono text-[11px] bg-[var(--viz-bg,#fafafa)] border border-[var(--viz-border,#e5e7eb)] rounded px-1.5 py-0.5 text-[var(--viz-node-label,#374151)] max-w-[100px] focus:outline-2 focus:outline-[var(--viz-accent,#6366f1)] focus:outline-offset-[-1px] option-select"
          .value=${this._options.format}
          @change=${(e: Event) =>
            this._updateOption("format", (e.target as HTMLSelectElement).value)}
        >
          <option value="svg">SVG</option>
          <option value="png">PNG</option>
        </select>
      </div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono text-[11px] text-[var(--viz-node-label,#374151)]">Scale</span>
        <select
          class="font-mono text-[11px] bg-[var(--viz-bg,#fafafa)] border border-[var(--viz-border,#e5e7eb)] rounded px-1.5 py-0.5 text-[var(--viz-node-label,#374151)] max-w-[100px] focus:outline-2 focus:outline-[var(--viz-accent,#6366f1)] focus:outline-offset-[-1px] option-select"
          .value=${String(this._options.scale)}
          @change=${(e: Event) =>
            this._updateOption("scale", Number((e.target as HTMLSelectElement).value))}
        >
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
          <option value="4">4x</option>
        </select>
      </div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono text-[11px] text-[var(--viz-node-label,#374151)]">Background</span>
        <select
          class="font-mono text-[11px] bg-[var(--viz-bg,#fafafa)] border border-[var(--viz-border,#e5e7eb)] rounded px-1.5 py-0.5 text-[var(--viz-node-label,#374151)] max-w-[100px] focus:outline-2 focus:outline-[var(--viz-accent,#6366f1)] focus:outline-offset-[-1px] option-select"
          .value=${this._options.background}
          @change=${(e: Event) =>
            this._updateOption("background", (e.target as HTMLSelectElement).value)}
        >
          <option value="white">White</option>
          <option value="transparent">Transparent</option>
          <option value="current">Theme</option>
        </select>
      </div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono text-[11px] text-[var(--viz-node-label,#374151)]">Padding</span>
        <input
          class="font-mono text-[11px] bg-[var(--viz-bg,#fafafa)] border border-[var(--viz-border,#e5e7eb)] rounded px-1.5 py-0.5 text-[var(--viz-node-label,#374151)] max-w-[100px] focus:outline-2 focus:outline-[var(--viz-accent,#6366f1)] focus:outline-offset-[-1px] option-select"
          type="number"
          min="0"
          max="200"
          .value=${String(this._options.padding)}
          @change=${(e: Event) =>
            this._updateOption("padding", Number((e.target as HTMLInputElement).value))}
        />
      </div>
      <div class="flex gap-1 mt-2">
        <button
          class="flex-1 px-2 py-1.5 border border-[var(--viz-accent,#6366f1)] bg-[var(--viz-accent,#6366f1)] cursor-pointer rounded font-mono text-[11px] text-white transition-colors duration-150 hover:opacity-90 export-btn"
          @click=${() => this._handleExportWithFormat(this._options.format)}
        >
          Export ${this._options.format.toUpperCase()}
        </button>
      </div>
    </div>`;
  }

  _render() {
    const menu = this._visible
      ? html`<div class="fixed inset-0 z-100 menu-overlay" @click=${this._handleOverlayClick}>
          <div
            class="absolute top-full right-0 mt-1 bg-[var(--viz-node-bg,#ffffff)] border border-[var(--viz-border,#e5e7eb)] rounded-lg p-1 min-w-[220px] shadow-[0_4px_12px_rgba(0,0,0,.12)] z-[101] menu"
            role="menu"
          >
            ${this._showOptions
              ? this._renderOptionsPanel()
              : html`
                  <button
                    class="flex items-center gap-2 w-full px-3 py-2 border-none bg-transparent cursor-pointer rounded font-mono text-xs text-[var(--viz-node-label,#374151)] transition-colors duration-150 text-left hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] menu-item"
                    role="menuitem"
                    @click=${() => {
                      this._showOptions = true;
                      this._options.format = "svg";
                      this._render();
                    }}
                  >
                    <svg
                      class="w-4 h-4 flex-shrink-0 opacity-70"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Export SVG
                  </button>
                  <button
                    class="flex items-center gap-2 w-full px-3 py-2 border-none bg-transparent cursor-pointer rounded font-mono text-xs text-[var(--viz-node-label,#374151)] transition-colors duration-150 text-left hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] menu-item"
                    role="menuitem"
                    @click=${() => {
                      this._showOptions = true;
                      this._options.format = "png";
                      this._render();
                    }}
                  >
                    <svg
                      class="w-4 h-4 flex-shrink-0 opacity-70"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    Export PNG
                  </button>
                  <div class="h-px bg-[var(--viz-border,#e5e7eb)] my-1"></div>
                  <button
                    class="flex items-center gap-2 w-full px-3 py-2 border-none bg-transparent cursor-pointer rounded font-mono text-xs text-[var(--viz-node-label,#374151)] transition-colors duration-150 text-left hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] menu-item"
                    role="menuitem"
                    @click=${() => this._handleCopyJson()}
                  >
                    <svg
                      class="w-4 h-4 flex-shrink-0 opacity-70"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy as JSON
                  </button>
                  <button
                    class="flex items-center gap-2 w-full px-3 py-2 border-none bg-transparent cursor-pointer rounded font-mono text-xs text-[var(--viz-node-label,#374151)] transition-colors duration-150 text-left hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-[-2px] menu-item"
                    role="menuitem"
                    @click=${() => this._handleShareUrl()}
                  >
                    <svg
                      class="w-4 h-4 flex-shrink-0 opacity-70"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Share via URL
                  </button>
                `}
          </div>
        </div>`
      : "";

    const toast = this._toast
      ? html`<div
          class="fixed bottom-5 left-1/2 -translate-x-1/2 bg-[var(--viz-node-bg,#ffffff)] border border-[var(--viz-border,#e5e7eb)] rounded-md px-4 py-2 font-mono text-xs text-[var(--viz-node-label,#374151)] shadow-[0_2px_8px_rgba(0,0,0,.12)] z-[200] transition-opacity duration-200 pointer-events-none toast${this
            ._toast
            ? " !opacity-100"
            : " opacity-0"}"
        >
          ${this._toast}
        </div>`
      : "";

    render(html`${unsafeHTML(STYLES)}${menu}${toast}`, this._shadow);
  }
}

customElements.define("export-menu", ExportMenuComponent);
