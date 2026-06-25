import type { HistoryEntry, StateVisit, TransitionRecord, EffectRecord } from "./types.ts";

const entriesMap = new WeakMap<History, HistoryEntry[]>();

function entriesOfType(
  entries: readonly HistoryEntry[],
  type: HistoryEntry["type"],
): HistoryEntry["data"][] {
  return entries.filter((e) => e.type === type).map((e) => e.data);
}

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
    return entriesOfType(entriesMap.get(this)!, "state_visit") as StateVisit[];
  }

  transitions(): TransitionRecord[] {
    return entriesOfType(entriesMap.get(this)!, "transition") as TransitionRecord[];
  }

  effects(): EffectRecord[] {
    return entriesOfType(entriesMap.get(this)!, "effect") as EffectRecord[];
  }

  sends(): Array<{ event: string; timestamp: number }> {
    return entriesOfType(entriesMap.get(this)!, "send") as Array<{
      event: string;
      timestamp: number;
    }>;
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
