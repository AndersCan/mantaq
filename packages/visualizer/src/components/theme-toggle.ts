import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { $theme, cycleTheme, initTheme, type ThemeMode } from "../graph-store.ts";

const STYLES = `<style>
  :host { display: inline-flex; }
  :host([data-mode="dark"]) .icon-light { display: none; }
  :host([data-mode="dark"]) .icon-dark { display: block; }
  :host([data-mode="system"]) .icon-light { display: none; }
  :host([data-mode="system"]) .icon-system { display: block; }
  :host([data-mode="high-contrast"]) .icon-light { display: none; }
  :host([data-mode="high-contrast"]) .icon-hc { display: block; }
</style>`;

const ICON_LIGHT = html`<svg
  class="icon-light w-4 h-4"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="5" />
  <line x1="12" y1="1" x2="12" y2="3" />
  <line x1="12" y1="21" x2="12" y2="23" />
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
  <line x1="1" y1="12" x2="3" y2="12" />
  <line x1="21" y1="12" x2="23" y2="12" />
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
</svg>`;

const ICON_DARK = html`<svg
  class="icon-dark hidden w-4 h-4"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
</svg>`;

const ICON_SYSTEM = html`<svg
  class="icon-system hidden w-4 h-4"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
  <line x1="8" y1="21" x2="16" y2="21" />
  <line x1="12" y1="17" x2="12" y2="21" />
</svg>`;

const ICON_HC = html`<svg
  class="icon-hc hidden w-4 h-4"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 2v20M2 12h20" />
  <circle cx="12" cy="12" r="4" fill="currentColor" />
</svg>`;

const LABELS: Record<ThemeMode, string> = {
  light: "Switch to dark theme",
  dark: "Switch to high-contrast theme",
  "high-contrast": "Switch to system theme",
  system: "Switch to light theme",
};

export class ThemeToggleComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _theme: ThemeMode = "system";
  _unsubscribers: Array<() => void> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    initTheme();
    this._unsubscribers.push(
      $theme.subscribe((v) => {
        this._theme = v;
        this.setAttribute("data-mode", v);
        this._render();
      }),
    );
    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _handleClick = () => {
    cycleTheme();
  };

  _render() {
    render(
      html`${unsafeHTML(STYLES)}
        <button
          class="w-7 h-7 flex items-center justify-center bg-transparent cursor-pointer rounded text-[var(--viz-node-label,#374151)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2 theme-btn"
          aria-label=${LABELS[this._theme]}
          aria-pressed="false"
          title=${LABELS[this._theme]}
          @click=${this._handleClick}
        >
          ${ICON_LIGHT} ${ICON_DARK} ${ICON_HC} ${ICON_SYSTEM}
        </button>`,
      this._shadow,
    );
  }
}

customElements.define("theme-toggle", ThemeToggleComponent);
