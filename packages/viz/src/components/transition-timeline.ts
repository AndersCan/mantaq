import { html, render } from "lit-html";
import type { AnyActor } from "@mantaq/core";
import { instrument } from "@mantaq/traversal";
import type { InstrumentedActor, TransitionRecord } from "@mantaq/traversal";
import sharedStyles from "../styles.css?inline";

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
          ${sharedStyles} :host {
            display: block;
            border-top: 1px solid #1e293b;
            background: #0f172a;
          }
        </style>
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-slate-800">
          <span class="text-xs uppercase tracking-wider text-slate-500 font-semibold"
            >Timeline</span
          >
          <div class="flex gap-1">
            ${hasEntries
              ? html`<button
                  class="font-inherit text-xs px-1.5 py-0.5 border border-slate-700 rounded bg-transparent text-slate-400 cursor-pointer hover:bg-slate-800 hover:text-slate-200"
                  @click=${() => this.#clearHistory()}
                >
                  clear
                </button>`
              : ""}
          </div>
        </div>
        ${hasEntries
          ? html`
              <div
                class="flex items-center overflow-x-auto px-3 py-1.5 gap-0 viz-scrollbar scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900"
              >
                ${this.#entries.map(
                  (entry, i) => html`
                    ${i > 0
                      ? html`
                          <div
                            class="flex flex-col items-center flex-shrink-0 px-0.5 cursor-pointer rounded ${this.#selectedIndex ===
                            i
                              ? "bg-slate-800 outline outline-1 outline-blue-500"
                              : "hover:bg-slate-800"}"
                            @click=${() => this.#selectEntry(i)}
                          >
                            <span class="text-xs font-semibold text-blue-400 whitespace-nowrap"
                              >${entry.event}</span
                            >
                            <span class="text-xs text-slate-600">→</span>
                            <span class="text-xs text-slate-600 whitespace-nowrap"
                              >${entry.timestamp}ms</span
                            >
                          </div>
                        `
                      : ""}
                    <div class="flex flex-col items-center flex-shrink-0">
                      <div
                        class="flex items-center gap-1 px-1.5 py-0.5 rounded ${i ===
                        this.#entries.length - 1
                          ? "bg-slate-800"
                          : ""}"
                      >
                        <span
                          class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${i ===
                          this.#entries.length - 1
                            ? "bg-blue-500 border border-blue-500"
                            : "border-1.5 border-slate-500 bg-transparent"}"
                        ></span>
                        <span
                          class="text-xs whitespace-nowrap ${i === this.#entries.length - 1
                            ? "text-slate-200 font-semibold"
                            : "text-slate-400"}"
                          >${i === 0 ? entry.from : entry.to}</span
                        >
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : html`<div class="px-3 py-1.5 text-xs text-slate-600 italic">No transitions yet</div>`}
      `,
      this,
    );
  }
}

customElements.define("transition-timeline", TransitionTimeline);
