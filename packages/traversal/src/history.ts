import type {
  EffectRecord,
  HistoryEntry,
  SendRecord,
  StateVisit,
  TransitionRecord,
} from "./types.ts";

export interface History {
  append(entry: HistoryEntry): void;
  entries(): readonly HistoryEntry[];
  stateVisits(): StateVisit[];
  transitions(): TransitionRecord[];
  effects(): EffectRecord[];
  sends(): SendRecord[];
  visitedStates(): Set<string>;
  firedTransitions(): Set<string>;
  reset(): void;
}

function entriesOfType<Type extends HistoryEntry["type"]>(
  recordedEntries: readonly HistoryEntry[],
  options: { type: Type },
): Extract<HistoryEntry, { type: Type }>["data"][] {
  return recordedEntries
    .filter((entry): entry is Extract<HistoryEntry, { type: Type }> => entry.type === options.type)
    .map((entry) => entry.data);
}

/**
 * History records the runtime trace of an instrumented actor. A closure over
 * the entry list keeps the recorder mutable without exposing the raw array.
 */
export function createHistory(): History {
  const recordedEntries: HistoryEntry[] = [];

  function append(entry: HistoryEntry): void {
    recordedEntries.push(entry);
  }

  function entries(): readonly HistoryEntry[] {
    return recordedEntries;
  }

  function stateVisits(): StateVisit[] {
    return entriesOfType(recordedEntries, { type: "state_visit" });
  }

  function transitions(): TransitionRecord[] {
    return entriesOfType(recordedEntries, { type: "transition" });
  }

  function effects(): EffectRecord[] {
    return entriesOfType(recordedEntries, { type: "effect" });
  }

  function sends(): SendRecord[] {
    return entriesOfType(recordedEntries, { type: "send" });
  }

  function visitedStates(): Set<string> {
    const visited = new Set<string>();
    for (const visit of stateVisits()) {
      visited.add(visit.stateName);
    }
    return visited;
  }

  function firedTransitions(): Set<string> {
    const fired = new Set<string>();
    for (const record of transitions()) {
      fired.add(`${record.from}:${record.event}`);
    }
    return fired;
  }

  function reset(): void {
    recordedEntries.length = 0;
  }

  return {
    append,
    entries,
    stateVisits,
    transitions,
    effects,
    sends,
    visitedStates,
    firedTransitions,
    reset,
  };
}
