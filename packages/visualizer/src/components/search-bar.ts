import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { $searchQuery, $searchResults, setSearchQuery } from "../graph-store.ts";

const STYLES = `<style>
  :host { display: block; }
  .search-input::placeholder { color: var(--viz-text-muted, #9ca3af); }
</style>`;

export class SearchBar extends HTMLElement {
  _shadow: ShadowRoot;
  _query = "";
  _results: string[] = [];
  _unsubscribers: Array<() => void> = [];
  _input: HTMLInputElement | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $searchQuery.subscribe((v) => {
        this._query = v;
        this._renderComponent();
      }),
      $searchResults.subscribe((v) => {
        this._results = [...v];
        this._renderComponent();
      }),
    );
    this._renderComponent();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  focusInput() {
    this._input?.focus();
    this._input?.select();
  }

  _handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setSearchQuery(value);
  };

  _handleClear = () => {
    setSearchQuery("");
    this._input?.focus();
  };

  _renderComponent() {
    const hasQuery = this._query.length > 0;
    const resultText = hasQuery
      ? `${this._results.length} match${this._results.length !== 1 ? "es" : ""}`
      : "";

    render(
      html`${unsafeHTML(STYLES)}
        <div class="relative flex items-center">
          <svg
            class="search-icon absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--viz-text-muted,#9ca3af)] pointer-events-none"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="4.5" />
            <line x1="10" y1="10" x2="14" y2="14" />
          </svg>
          <input
            class="search-input w-full py-1.5 pl-7 pr-2.5 font-mono text-xs text-[var(--viz-node-label)] bg-[var(--viz-node-bg)] border border-[var(--viz-border)] rounded-md outline-none transition-colors duration-150 focus:border-[var(--viz-accent,#3b82f6)]"
            type="text"
            placeholder="Search nodes..."
            .value=${this._query}
            @input=${this._handleInput}
            aria-label="Search nodes by name"
          />
          ${hasQuery
            ? html`<button
                class="clear-btn absolute right-[60px] top-1/2 -translate-y-1/2 w-[18px] h-[18px] flex items-center justify-center bg-transparent cursor-pointer rounded-full text-xs text-[var(--viz-text-muted)] transition-colors duration-150 hover:bg-[var(--viz-border)]"
                @click=${this._handleClear}
                aria-label="Clear search"
              >
                &times;
              </button>`
            : ""}
          ${hasQuery
            ? html`<span
                class="result-count absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[var(--viz-text-muted)] pointer-events-none"
                role="status"
                aria-live="polite"
                >${resultText}</span
              >`
            : ""}
        </div>`,
      this._shadow,
    );
    this._input = this._shadow.querySelector("input");
  }
}

customElements.define("search-bar", SearchBar);
