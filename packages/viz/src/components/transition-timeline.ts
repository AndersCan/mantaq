import { html, render } from "lit-html";
import type { AnyActor } from "@mantaq/core";
import { instrument } from "@mantaq/traversal";
import type { InstrumentedActor, TransitionRecord } from "@mantaq/traversal";

interface TimelineEntry {
  event: string;
  from: string;
  to: string;
  timestamp: number;
  index: number;
}

export class TransitionTimeline extends HTMLElement {
  #actor: AnyActor | null = null;
  #instrumented: InstrumentedActor | null = null;
  #entries: TimelineEntry[] = [];
  #selectedIndex: number | null = null;
  #unsub: (() => void) | null = null;

  set actor(a: AnyActor | null) {
    this.#teardown();
    this.#actor = a;
    this.#entries = [];
    this.#selectedIndex = null;
    if (a) {
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
    this.#entries = transitions.map((t: TransitionRecord, i: number) => ({
      event: t.event,
      from: t.from,
      to: t.to ?? "—",
      timestamp: t.timestamp,
      index: i,
    }));
  }

  #selectEntry(index: number) {
    this.#selectedIndex = index;
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
            padding: 0.4rem 1rem;
            border-bottom: 1px solid #1e293b;
          }
          .timeline-title {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            font-weight: 600;
          }
          .timeline-count {
            font-size: 0.7rem;
            color: #475569;
          }
          .timeline-track {
            display: flex;
            align-items: stretch;
            overflow-x: auto;
            padding: 0.5rem 1rem;
            gap: 0;
            scrollbar-width: thin;
            scrollbar-color: #334155 #0f172a;
          }
          .timeline-track::-webkit-scrollbar {
            height: 4px;
          }
          .timeline-track::-webkit-scrollbar-track {
            background: #0f172a;
          }
          .timeline-track::-webkit-scrollbar-thumb {
            background: #334155;
            border-radius: 2px;
          }
          .timeline-empty {
            padding: 0.6rem 1rem;
            font-size: 0.75rem;
            color: #475569;
            font-style: italic;
          }
          .timeline-entry {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: 80px;
            cursor: pointer;
            position: relative;
            padding: 0.3rem 0.5rem;
            border-radius: 4px;
            transition: background 0.15s;
          }
          .timeline-entry:hover {
            background: #1e293b;
          }
          .timeline-entry.selected {
            background: #1e293b;
            outline: 1px solid #3b82f6;
          }
          .timeline-event {
            font-size: 0.75rem;
            font-weight: 600;
            color: #e2e8f0;
            white-space: nowrap;
          }
          .timeline-transition {
            font-size: 0.65rem;
            color: #64748b;
            white-space: nowrap;
            margin-top: 0.15rem;
          }
          .timeline-transition .arrow {
            color: #475569;
            margin: 0 0.15rem;
          }
          .timeline-transition .state {
            color: #94a3b8;
          }
          .timeline-connector {
            display: flex;
            align-items: center;
            color: #334155;
            font-size: 0.8rem;
            flex-shrink: 0;
          }
        </style>
        <div class="timeline-header">
          <span class="timeline-title">Transition Timeline</span>
          <span class="timeline-count">${this.#entries.length} transitions</span>
        </div>
        ${hasEntries
          ? html`
              <div class="timeline-track">
                ${this.#entries.map(
                  (entry, i) => html`
                    ${i > 0 ? html`<span class="timeline-connector">→</span>` : ""}
                    <div
                      class="timeline-entry ${this.#selectedIndex === i ? "selected" : ""}"
                      @click=${() => this.#selectEntry(i)}
                    >
                      <span class="timeline-event">${entry.event}</span>
                      <span class="timeline-transition">
                        <span class="state">${entry.from}</span>
                        <span class="arrow">→</span>
                        <span class="state">${entry.to}</span>
                      </span>
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
