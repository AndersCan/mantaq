import type { TimerActionDetail } from "../types.ts";

const timerStyles = `
  @unocss-placeholder
  :host { display: block; pointer-events: auto; }
`;

export class TimerIndicator extends HTMLElement {
  timerId = "";
  nodeId = "";
  label = "";
  duration = 0;
  elapsed = 0;
  status: "running" | "paused" | "cancelled" = "running";

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const progress = this.duration > 0 ? Math.min((this.elapsed / this.duration) * 100, 100) : 0;
    const badgeClass =
      this.status === "paused"
        ? "inline-flex items-center gap-1 bg-[var(--viz-timer-paused-bg,#e5e7eb)] border border-[var(--viz-timer-paused-border,#9ca3af)] rounded-[10px] px-2 py-0.5 font-mono text-[11px] text-[var(--viz-timer-paused-text,#6b7280)] whitespace-nowrap cursor-default transition-colors duration-200 paused"
        : this.status === "cancelled"
          ? "inline-flex items-center gap-1 bg-[var(--viz-timer-cancelled-bg,#fef2f2)] border border-[var(--viz-timer-cancelled-border,#ef4444)] rounded-[10px] px-2 py-0.5 font-mono text-[11px] text-[var(--viz-timer-cancelled-text,#dc2626)] line-through whitespace-nowrap cursor-default transition-colors duration-200 cancelled"
          : "inline-flex items-center gap-1 bg-[var(--viz-timer-bg,#fef3c7)] border border-[var(--viz-timer-border,#f59e0b)] rounded-[10px] px-2 py-0.5 font-mono text-[11px] text-[var(--viz-timer-text,#92400e)] whitespace-nowrap cursor-default transition-colors duration-200";

    this.innerHTML =
      `<style>${timerStyles}</style>` +
      `<div class="${badgeClass} timer-badge" title="Timer: ${this.label} (${this.status})">` +
      `<svg class="w-3 h-3 timer-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">` +
      `<circle cx="8" cy="9" r="6"/><line x1="8" y1="9" x2="8" y2="6"/><line x1="8" y1="9" x2="10" y2="9"/></svg>` +
      `<span>${this.label}</span>` +
      `<div class="w-10 h-1 rounded-[2px] bg-[var(--viz-timer-track,#e5e7eb)] overflow-hidden timer-progress"><div class="h-full rounded-[2px] bg-[var(--viz-timer-fill,#f59e0b)] transition-[width] duration-300 timer-progress-bar" style="width:${progress}%"></div></div>` +
      (this.status !== "cancelled"
        ? `<div class="flex gap-0.5 ml-1">` +
          (this.status === "running"
            ? `<button class="timer-btn w-[18px] h-[18px] border-none bg-transparent cursor-pointer rounded-[3px] p-0 flex items-center justify-center text-[var(--viz-timer-text,#92400e)] transition-colors duration-150 hover:bg-black/10" data-action="pause" title="Pause"><svg class="w-2.5 h-2.5" viewBox="0 0 10 10"><rect x="2" y="1" width="2" height="8"/><rect x="6" y="1" width="2" height="8"/></svg></button>`
            : `<button class="timer-btn w-[18px] h-[18px] border-none bg-transparent cursor-pointer rounded-[3px] p-0 flex items-center justify-center text-[var(--viz-timer-text,#92400e)] transition-colors duration-150 hover:bg-black/10" data-action="resume" title="Resume"><svg class="w-2.5 h-2.5" viewBox="0 0 10 10"><polygon points="2,1 9,5 2,9"/></svg></button>`) +
          `<button class="timer-btn w-[18px] h-[18px] border-none bg-transparent cursor-pointer rounded-[3px] p-0 flex items-center justify-center text-[var(--viz-timer-text,#92400e)] transition-colors duration-150 hover:bg-black/10" data-action="cancel" title="Cancel"><svg class="w-2.5 h-2.5" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg></button>` +
          `</div>`
        : "") +
      `</div>`;

    this._attachEvents();
  }

  _attachEvents() {
    for (const btn of this.querySelectorAll(".timer-btn")) {
      btn.addEventListener("click", (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action;
        if (!action) return;
        const detail: TimerActionDetail = { timerId: this.timerId, action };
        this.dispatchEvent(
          new CustomEvent("timer-action", {
            detail,
            bubbles: true,
            composed: true,
          }),
        );
      });
    }
  }
}

customElements.define("timer-indicator", TimerIndicator);
