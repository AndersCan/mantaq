import { html, render } from "lit-html";
import type { AnyActor } from "@mantaq/core";
import { instrument } from "@mantaq/traversal";
import type { InstrumentedActor, TransitionRecord } from "@mantaq/traversal";

interface TimelineEntry {
  event: string;
  from: string;
  to: string;
  timestamp: number;
}

export class TransitionTimeline extends HTMLElement {
  #actor: AnyActor | null = null;
  #instrumented: InstrumentedActor | null = null;
  #entries: TimelineEntry[] = [];
  #selectedIndex: number | null = null;
  #unsub: (() => void) | null = null;
  #startTime: number = 0;

  set actor(a: AnyActor | null) {
    this.#teardown();
    this.#actor = a;
    this.#entries = [];
    this.#selectedIndex = null;
    if (a) {
      this.#startTime = Date.now();
      this.#instrumented = instrument(a);
      this.#syncEntries();
      this.#unsub = a.on("change", () => {
        this.#syncEntries();
        if (this.isConnected) this.#render();
      });
    }
    if (this.isConnected) this.#render();
  }

  get actor(): AnyActor | null {
    return this.#actor;
  }

  connectedCallback() {
    this.#render();
  }

  disconnectedCallback() {
    this.#teardown();
    render("", this);
  }

  #teardown() {
    this.#unsub?.();
    this.#unsub = null;
    this.#instrumented = null;
  }

  #syncEntries() {
    if (!this.#instrumented) return;
    const transitions = this.#instrumented.history.transitions();
    this.#entries = transitions.map((t: TransitionRecord) => ({
      event: t.event,
      from: t.from,
      to: t.to ?? "—",
      timestamp: t.timestamp - this.#startTime,
    }));
  }

  #selectEntry(index: number) {
    this.#selectedIndex = this.#selectedIndex === index ? null : index;
    this.#render();
  }

  #clearHistory() {
    if (this.#instrumented) {
      this.#instrumented.history.reset();
    }
    this.#entries = [];
    this.#selectedIndex = null;
    if (this.#actor) {
      this.#startTime = Date.now();
      this.#instrumented = instrument(this.#actor);
      this.#unsub?.();
      this.#unsub = this.#actor.on("change", () => {
        this.#syncEntries();
        if (this.isConnected) this.#render();
      });
    }
    this.#render();
  }

  #render() {
    const hasEntries = this.#entries.length > 0;

    render(
      html`
        <style>
          :host {
            display: block;
            border-top: 1px solid #1e293b;
            background: #0f172a;
          }
          .timeline-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.3rem 0.75rem;
            border-bottom: 1px solid #1e293b;
          }
          .timeline-title {
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            font-weight: 600;
          }
          .timeline-actions {
            display: flex;
            gap: 0.3rem;
          }
          .timeline-btn {
            font-family: inherit;
            font-size: 0.6rem;
            padding: 0.1rem 0.4rem;
            border: 1px solid #334155;
            border-radius: 3px;
            background: transparent;
            color: #94a3b8;
            cursor: pointer;
          }
          .timeline-btn:hover {
            background: #1e293b;
            color: #e2e8f0;
          }
          .timeline-track {
            display: flex;
            align-items: center;
            overflow-x: auto;
            padding: 0.4rem 0.75rem;
            gap: 0;
            scrollbar-width: thin;
            scrollbar-color: #334155 #0f172a;
          }
          .timeline-track::-webkit-scrollbar {
            height: 3px;
          }
          .timeline-track::-webkit-scrollbar-track {
            background: #0f172a;
          }
          .timeline-track::-webkit-scrollbar-thumb {
            background: #334155;
            border-radius: 2px;
          }
          .timeline-empty {
            padding: 0.4rem 0.75rem;
            font-size: 0.65rem;
            color: #475569;
            font-style: italic;
          }
          .tl-node {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex-shrink: 0;
          }
          .tl-state {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            cursor: default;
          }
          .tl-state.active {
            background: #1e293b;
          }
          .tl-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            border: 1.5px solid #64748b;
            background: transparent;
            flex-shrink: 0;
          }
          .tl-dot.active {
            background: #3b82f6;
            border-color: #3b82f6;
          }
          .tl-state-name {
            font-size: 0.65rem;
            color: #94a3b8;
            white-space: nowrap;
          }
          .tl-state.active .tl-state-name {
            color: #e2e8f0;
            font-weight: 600;
          }
          .tl-transition {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex-shrink: 0;
            padding: 0 0.2rem;
            cursor: pointer;
            border-radius: 3px;
          }
          .tl-transition:hover {
            background: #1e293b;
          }
          .tl-transition.selected {
            background: #1e293b;
            outline: 1px solid #3b82f6;
          }
          .tl-event-name {
            font-size: 0.6rem;
            font-weight: 600;
            color: #60a5fa;
            white-space: nowrap;
          }
          .tl-arrow {
            font-size: 0.55rem;
            color: #475569;
          }
          .tl-time {
            font-size: 0.5rem;
            color: #475569;
            white-space: nowrap;
          }
        </style>
        <div class="timeline-header">
          <span class="timeline-title">Timeline</span>
          <div class="timeline-actions">
            ${hasEntries
              ? html`<button class="timeline-btn" @click=${() => this.#clearHistory()}>
                  clear
                </button>`
              : ""}
          </div>
        </div>
        ${hasEntries
          ? html`
              <div class="timeline-track">
                ${this.#entries.map(
                  (entry, i) => html`
                    ${i > 0
                      ? html`
                          <div
                            class="tl-transition ${this.#selectedIndex === i ? "selected" : ""}"
                            @click=${() => this.#selectEntry(i)}
                          >
                            <span class="tl-event-name">${entry.event}</span>
                            <span class="tl-arrow">→</span>
                            <span class="tl-time">${entry.timestamp}ms</span>
                          </div>
                        `
                      : ""}
                    <div class="tl-node">
                      <div class="tl-state ${i === this.#entries.length - 1 ? "active" : ""}">
                        <span
                          class="tl-dot ${i === this.#entries.length - 1 ? "active" : ""}"
                        ></span>
                        <span class="tl-state-name">${i === 0 ? entry.from : entry.to}</span>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : html`<div class="timeline-empty">No transitions yet</div>`}
      `,
      this,
    );
  }
}

customElements.define("transition-timeline", TransitionTimeline);
