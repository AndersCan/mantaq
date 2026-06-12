import type { HistoryEntry, StateVisit, TransitionRecord, EffectRecord } from "./types.ts";

const entriesMap = new WeakMap<History, HistoryEntry[]>();

export class History {
  constructor() {
    entriesMap.set(this, []);
  }

  append(entry: HistoryEntry): void {
    entriesMap.get(this)!.push(entry);
  }

  entries(): readonly HistoryEntry[] {
    return entriesMap.get(this)!;
  }

  stateVisits(): StateVisit[] {
    return entriesMap
      .get(this)!
      .filter(
        (e): e is HistoryEntry & { type: "state_visit"; data: StateVisit } =>
          e.type === "state_visit",
      )
      .map((e) => e.data);
  }

  transitions(): TransitionRecord[] {
    return entriesMap
      .get(this)!
      .filter(
        (e): e is HistoryEntry & { type: "transition"; data: TransitionRecord } =>
          e.type === "transition",
      )
      .map((e) => e.data);
  }

  effects(): EffectRecord[] {
    return entriesMap
      .get(this)!
      .filter(
        (e): e is HistoryEntry & { type: "effect"; data: EffectRecord } => e.type === "effect",
      )
      .map((e) => e.data);
  }

  sends(): Array<{ event: string; timestamp: number }> {
    return entriesMap
      .get(this)!
      .filter(
        (e): e is HistoryEntry & { type: "send"; data: { event: string; timestamp: number } } =>
          e.type === "send",
      )
      .map((e) => e.data);
  }

  visitedStates(): Set<string> {
    const result = new Set<string>();
    for (const visit of this.stateVisits()) {
      result.add(visit.stateName);
    }
    return result;
  }

  firedTransitions(): Set<string> {
    const result = new Set<string>();
    for (const t of this.transitions()) {
      result.add(`${t.from}:${t.event}`);
    }
    return result;
  }

  reset(): void {
    const arr = entriesMap.get(this)!;
    arr.length = 0;
  }
}
