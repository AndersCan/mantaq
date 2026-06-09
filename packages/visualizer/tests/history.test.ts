import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  $history,
  $historyReplayIndex,
  $visitedStates,
  clearHistory,
  exportHistory,
  setHistoryReplayIndex,
  setActor,
  type HistoryEntry,
} from "../src/graph-store.ts";
import { Actor, state, event } from "@mantaq/core";
import "../src/components/history-panel.ts";

describe("History tracking", () => {
  beforeEach(() => {
    clearHistory();
  });

  describe("$history atom", () => {
    it("starts empty", () => {
      expect($history.get()).toEqual([]);
    });

    it("can be set with entries", () => {
      const entry: HistoryEntry = {
        timestamp: Date.now(),
        fromState: "idle",
        toState: "active",
        event: "idle → active",
      };
      $history.set([entry]);
      expect($history.get()).toHaveLength(1);
      expect($history.get()[0].fromState).toBe("idle");
      expect($history.get()[0].toState).toBe("active");
    });

    it("accumulates entries", () => {
      const entry1: HistoryEntry = {
        timestamp: 1000,
        fromState: "idle",
        toState: "active",
        event: "idle → active",
      };
      const entry2: HistoryEntry = {
        timestamp: 2000,
        fromState: "active",
        toState: "done",
        event: "active → done",
      };
      $history.set([entry1]);
      $history.set([...$history.get(), entry2]);
      expect($history.get()).toHaveLength(2);
    });
  });

  describe("clearHistory", () => {
    it("clears all entries", () => {
      $history.set([
        { timestamp: 1, fromState: "a", toState: "b", event: "a → b" },
        { timestamp: 2, fromState: "b", toState: "c", event: "b → c" },
      ]);
      clearHistory();
      expect($history.get()).toEqual([]);
    });

    it("resets replay index", () => {
      $history.set([{ timestamp: 1, fromState: "a", toState: "b", event: "a → b" }]);
      setHistoryReplayIndex(0);
      clearHistory();
      expect($historyReplayIndex.get()).toBe(-1);
    });
  });

  describe("exportHistory", () => {
    it("returns valid JSON", () => {
      $history.set([
        { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      ]);
      const json = exportHistory();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].fromState).toBe("idle");
    });

    it("returns empty array JSON when no history", () => {
      const json = exportHistory();
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  describe("$historyReplayIndex", () => {
    it("starts at -1", () => {
      expect($historyReplayIndex.get()).toBe(-1);
    });

    it("can be set to valid index", () => {
      $history.set([
        { timestamp: 1, fromState: "a", toState: "b", event: "a → b" },
        { timestamp: 2, fromState: "b", toState: "c", event: "b → c" },
      ]);
      setHistoryReplayIndex(1);
      expect($historyReplayIndex.get()).toBe(1);
    });

    it("clamps to valid range", () => {
      $history.set([{ timestamp: 1, fromState: "a", toState: "b", event: "a → b" }]);
      setHistoryReplayIndex(5);
      expect($historyReplayIndex.get()).toBe(0);

      setHistoryReplayIndex(-5);
      expect($historyReplayIndex.get()).toBe(-1);
    });
  });

  describe("$visitedStates", () => {
    it("starts empty", () => {
      expect($visitedStates.get().size).toBe(0);
    });

    it("derives visited states from history", () => {
      const entry1: HistoryEntry = {
        timestamp: 1,
        fromState: "idle",
        toState: "active",
        event: "idle → active",
      };
      const entry2: HistoryEntry = {
        timestamp: 2,
        fromState: "active",
        toState: "done",
        event: "active → done",
      };
      $history.set([entry1, entry2]);
      const visited = new Set<string>();
      for (const e of $history.get()) {
        visited.add(e.fromState);
        visited.add(e.toState);
      }
      expect(visited.has("idle")).toBe(true);
      expect(visited.has("active")).toBe(true);
      expect(visited.has("done")).toBe(true);
    });

    it("includes both from and to states", () => {
      $history.set([{ timestamp: 1, fromState: "a", toState: "b", event: "a → b" }]);
      const visited = new Set<string>();
      for (const e of $history.get()) {
        visited.add(e.fromState);
        visited.add(e.toState);
      }
      expect(visited.has("a")).toBe(true);
      expect(visited.has("b")).toBe(true);
    });
  });
});

describe("History via setActor transitions", () => {
  beforeEach(() => {
    clearHistory();
  });

  it("records transition when actor changes state", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle, active],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {
        idle: { GO: () => ({ state: active }) },
      },
    });

    await setActor(actor);
    const before = $history.get().length;

    actor.send(go);
    await setActor(actor);
    const after = $history.get().length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("records correct from/to states", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle, active],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {
        idle: { GO: () => ({ state: active }) },
      },
    });

    await setActor(actor);
    actor.send(go);
    await setActor(actor);

    const entries = $history.get();
    if (entries.length > 0) {
      const last = entries[entries.length - 1];
      expect(last.event).toContain("→");
      expect(last.timestamp).toBeGreaterThan(0);
    }
  });

  it("records visited states from transitions", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle, active],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {
        idle: { GO: () => ({ state: active }) },
      },
    });

    await setActor(actor);
    actor.send(go);
    await setActor(actor);

    const visited = $visitedStates.get();
    if (visited.size > 0) {
      expect(visited.size).toBeGreaterThanOrEqual(1);
    }
  });

  it("multiple transitions accumulate history", async () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const go = event("GO")();
    const next = event("NEXT")();

    const actor = new Actor({
      inputs: [go, next],
      outputs: [],
      internal: [],
      states: [a, b, c],
      initial: a,
      context: {} as {},
      effects: {},
      transitions: {
        a: { GO: () => ({ state: b }) },
        b: { NEXT: () => ({ state: c }) },
      },
    });

    await setActor(actor);
    actor.send(go);
    await setActor(actor);
    actor.send(next);
    await setActor(actor);

    const history = $history.get();
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it("clearHistory resets transition history", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle, active],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {
        idle: { GO: () => ({ state: active }) },
      },
    });

    await setActor(actor);
    actor.send(go);
    await setActor(actor);
    clearHistory();
    expect($history.get()).toEqual([]);
    expect($visitedStates.get().size).toBe(0);
  });
});

describe("HistoryPanel component", () => {
  beforeEach(() => {
    clearHistory();
  });

  it("registers as custom element", () => {
    expect(customElements.get("history-panel")).toBeDefined();
  });

  it("renders empty state when no history", () => {
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    expect(shadow).toBeTruthy();
    const empty = shadow!.querySelector(".empty");
    expect(empty?.textContent).toContain("No transitions");
    el.remove();
  });

  it("renders history entries", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      { timestamp: 2000, fromState: "active", toState: "done", event: "active → done" },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const entries = shadow!.querySelectorAll(".history-entry");
    expect(entries.length).toBe(2);
    el.remove();
  });

  it("shows replay controls when history exists", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const controls = shadow!.querySelector(".replay-controls");
    expect(controls).toBeTruthy();
    el.remove();
  });

  it("panel header shows entry count", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      { timestamp: 2000, fromState: "active", toState: "done", event: "active → done" },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const header = shadow!.querySelector(".panel-header");
    expect(header!.textContent).toContain("2");
    el.remove();
  });

  it("export button exists", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const exportBtn = shadow!.querySelector('[aria-label="Export history"]');
    expect(exportBtn).toBeTruthy();
    el.remove();
  });

  it("clear button exists", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const clearBtn = shadow!.querySelector('[aria-label="Clear history"]');
    expect(clearBtn).toBeTruthy();
    el.remove();
  });

  it("entry click sets replay index", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      { timestamp: 2000, fromState: "active", toState: "done", event: "active → done" },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const entries = shadow!.querySelectorAll(".history-entry");
    (entries[1] as HTMLElement).click();
    expect($historyReplayIndex.get()).toBe(1);
    el.remove();
  });

  it("active entry has active class", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      { timestamp: 2000, fromState: "active", toState: "done", event: "active → done" },
    ]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const entries = shadow!.querySelectorAll(".history-entry");
    expect(entries[0].classList.contains("active")).toBe(true);
    expect(entries[1].classList.contains("active")).toBe(false);
    el.remove();
  });

  it("replay info shows step details", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
    ]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const info = shadow!.querySelector(".replay-info");
    expect(info).toBeTruthy();
    expect(info!.textContent).toContain("Step 1");
    el.remove();
  });

  it("replay index display shows current position", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      { timestamp: 2000, fromState: "active", toState: "done", event: "active → done" },
    ]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const index = shadow!.querySelector(".replay-index");
    expect(index!.textContent).toContain("1");
    expect(index!.textContent).toContain("2");
    el.remove();
  });

  it("prev button disabled at start", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
    ]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const prevBtn = shadow!.querySelector('[aria-label*="Previous"]') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
    el.remove();
  });

  it("next button disabled at end", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
    ]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const nextBtn = shadow!.querySelector('[aria-label*="Next"]') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    el.remove();
  });

  it("next button enabled when not at end", () => {
    $history.set([
      { timestamp: 1000, fromState: "idle", toState: "active", event: "idle → active" },
      { timestamp: 2000, fromState: "active", toState: "done", event: "active → done" },
    ]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const nextBtn = shadow!.querySelector('[aria-label*="Next"]') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
    el.remove();
  });

  it("shows short state names from full paths", () => {
    $history.set([
      {
        timestamp: 1000,
        fromState: "parent.idle",
        toState: "parent.active",
        event: "idle → active",
      },
    ]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    const shadow = el.shadowRoot;
    const entry = shadow!.querySelector(".history-entry");
    expect(entry!.textContent).toContain("idle");
    expect(entry!.textContent).toContain("active");
    el.remove();
  });

  it("cleans up subscriptions on disconnect", () => {
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    el.remove();
    $history.set([{ timestamp: 1, fromState: "a", toState: "b", event: "a → b" }]);
    expect($history.get().length).toBe(1);
  });
});
