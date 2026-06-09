import { html } from "lit";
import { render } from "lit/html.js";
import {
  $animationEnabled,
  $animationSpeed,
  $prefersReducedMotion,
  toggleAnimation,
  setAnimationSpeed,
} from "../graph-store.ts";

const STYLES = `<style>
  :host { display: inline-flex; align-items: center; gap: 4px; }
  @media (prefers-reduced-motion: reduce) { .anim-btn, .speed-btn { opacity: 0.5; pointer-events: none; } }
</style>`;

const ICON_ANIM = html`<svg
  class="w-4 h-4"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polygon points="5 3 19 12 5 21 5 3" />
</svg>`;

const ICON_NO_ANIM = html`<svg
  class="w-4 h-4"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polygon points="5 3 19 12 5 21 5 3" />
  <line x1="4" y1="4" x2="20" y2="20" />
</svg>`;

export class AnimationToggleComponent extends HTMLElement {
  _shadow: ShadowRoot;
  _enabled = true;
  _speed = 1;
  _prefersReducedMotion = false;
  _unsubscribers: Array<() => void> = [];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._unsubscribers.push(
      $animationEnabled.subscribe((v) => {
        this._enabled = v;
        this._render();
      }),
      $animationSpeed.subscribe((v) => {
        this._speed = v;
        this._render();
      }),
      $prefersReducedMotion.subscribe((v) => {
        this._prefersReducedMotion = v;
        this._render();
      }),
    );
    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  _handleToggle = () => {
    toggleAnimation();
  };

  _handleSpeed = (speed: number) => {
    setAnimationSpeed(speed);
  };

  _render() {
    const disabled = this._prefersReducedMotion;
    render(
      html`${STYLES}
        <button
          class="anim-btn w-7 h-7 flex items-center justify-center bg-transparent cursor-pointer rounded text-[var(--viz-node-label,#374151)] transition-colors duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2${this
            ._enabled
            ? " active bg-[var(--viz-accent,#6366f1)] text-white"
            : ""}"
          aria-label=${this._enabled ? "Disable animations" : "Enable animations"}
          aria-pressed="${this._enabled}"
          title=${this._enabled ? "Disable animations" : "Enable animations"}
          ?disabled=${disabled}
          @click=${this._handleToggle}
        >
          ${this._enabled ? ICON_ANIM : ICON_NO_ANIM}
        </button>
        <div class="speed-group inline-flex gap-[2px]" role="group" aria-label="Animation speed">
          <button
            class="speed-btn font-mono text-[10px] px-1.5 py-0.5 border border-[var(--viz-border,#e5e7eb)] rounded bg-[var(--viz-node-bg,#ffffff)] text-[var(--viz-node-label,#374151)] cursor-pointer transition-all duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed${this
              ._speed === 0.5
              ? " active bg-[var(--viz-accent,#6366f1)] text-white border-[var(--viz-accent,#6366f1)]"
              : ""}"
            aria-pressed="${this._speed === 0.5}"
            ?disabled=${disabled || !this._enabled}
            @click=${() => this._handleSpeed(0.5)}
            title="Slow"
          >
            0.5x
          </button>
          <button
            class="speed-btn font-mono text-[10px] px-1.5 py-0.5 border border-[var(--viz-border,#e5e7eb)] rounded bg-[var(--viz-node-bg,#ffffff)] text-[var(--viz-node-label,#374151)] cursor-pointer transition-all duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed${this
              ._speed === 1
              ? " active bg-[var(--viz-accent,#6366f1)] text-white border-[var(--viz-accent,#6366f1)]"
              : ""}"
            aria-pressed="${this._speed === 1}"
            ?disabled=${disabled || !this._enabled}
            @click=${() => this._handleSpeed(1)}
            title="Normal"
          >
            1x
          </button>
          <button
            class="speed-btn font-mono text-[10px] px-1.5 py-0.5 border border-[var(--viz-border,#e5e7eb)] rounded bg-[var(--viz-node-bg,#ffffff)] text-[var(--viz-node-label,#374151)] cursor-pointer transition-all duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed${this
              ._speed === 2
              ? " active bg-[var(--viz-accent,#6366f1)] text-white border-[var(--viz-accent,#6366f1)]"
              : ""}"
            aria-pressed="${this._speed === 2}"
            ?disabled=${disabled || !this._enabled}
            @click=${() => this._handleSpeed(2)}
            title="Fast"
          >
            2x
          </button>
          <button
            class="speed-btn font-mono text-[10px] px-1.5 py-0.5 border border-[var(--viz-border,#e5e7eb)] rounded bg-[var(--viz-node-bg,#ffffff)] text-[var(--viz-node-label,#374151)] cursor-pointer transition-all duration-150 hover:bg-[var(--viz-border,#e5e7eb)] focus-visible:outline-2 focus-visible:outline-[var(--viz-accent,#6366f1)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed${this
              ._speed === 4
              ? " active bg-[var(--viz-accent,#6366f1)] text-white border-[var(--viz-accent,#6366f1)]"
              : ""}"
            aria-pressed="${this._speed === 4}"
            ?disabled=${disabled || !this._enabled}
            @click=${() => this._handleSpeed(4)}
            title="Very fast"
          >
            4x
          </button>
        </div>`,
      this._shadow,
    );
  }
}

customElements.define("animation-toggle", AnimationToggleComponent);
