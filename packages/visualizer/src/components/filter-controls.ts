import { html } from "lit";
import { render } from "lit/html.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { $filterStatus, type FilterStatus } from "../graph-store.ts";

const STYLES = `<style>
  :host { display: block; }
</style>`;

const STATUSES: FilterStatus[] = ["all", "active", "final", "inactive"];

export class FilterControls extends HTMLElement {
  _shadow: ShadowRoot;
  _status: FilterStatus = "all";
  _unsubscribers: Array<() => void> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $filterStatus.subscribe((v) => {
        this._status = v;
        this._renderComponent();
      }),
    );
    this._renderComponent();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _handleFilter = (status: FilterStatus) => {
    $filterStatus.set(status);
  };

  _renderComponent() {
    render(
      html`${unsafeHTML(STYLES)}
        <div
          class="filter-group flex gap-[2px] bg-[var(--viz-node-bg)] border border-[var(--viz-border)] rounded-md p-[2px]"
          role="group"
          aria-label="Filter nodes by status"
        >
          ${STATUSES.map(
            (s) =>
              html`<button
                class="filter-btn px-2.5 py-1 bg-transparent cursor-pointer rounded text-[11px] font-mono text-[var(--viz-text-muted,#6b7280)] transition-colors duration-150 capitalize${this
                  ._status === s
                  ? " active bg-[var(--viz-accent,#6366f1)] text-white"
                  : ""} hover:bg-[var(--viz-border)]"
                @click=${() => this._handleFilter(s)}
                aria-pressed=${this._status === s}
              >
                ${s}
              </button>`,
          )}
        </div>`,
      this._shadow,
    );
  }
}

customElements.define("filter-controls", FilterControls);
