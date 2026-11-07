import type { VizMachine } from "./schema.ts";

/** An arrow a reader can see and the code declares: transitions and stays, not fuzz-only, start or effect edges. */
export interface OutlineArrow {
  from: string;
  event: string;
  /** null = undetermined target. */
  to: string | null;
  kind: "transition" | "stay";
}

/** What "what changed" compares: the state ids and the arrows, in document order. */
export interface MachineOutline {
  states: string[];
  arrows: OutlineArrow[];
}

export interface MachineChanges {
  addedStates: string[];
  removedStates: string[];
  addedArrows: OutlineArrow[];
  removedArrows: OutlineArrow[];
}

export function arrowKey(arrow: OutlineArrow): string {
  return JSON.stringify([arrow.kind, arrow.from, arrow.event, arrow.to]);
}

export function outlineOf(machine: VizMachine): MachineOutline {
  const arrows = new Map<string, OutlineArrow>();
  for (const edge of machine.edges) {
    if (edge.kind !== "transition" && edge.kind !== "stay") continue;
    if (edge.origin !== "declared" && edge.origin !== "probe") continue;
    const arrow: OutlineArrow = {
      from: edge.from,
      event: edge.event,
      to: edge.to,
      kind: edge.kind,
    };
    const key = arrowKey(arrow);
    if (!arrows.has(key)) arrows.set(key, arrow);
  }
  return { states: machine.states.map((state) => state.id), arrows: [...arrows.values()] };
}

export function outlineChanges(before: MachineOutline, after: MachineOutline): MachineChanges {
  const beforeStates = new Set(before.states);
  const afterStates = new Set(after.states);
  const beforeKeys = new Set(before.arrows.map(arrowKey));
  const afterKeys = new Set(after.arrows.map(arrowKey));
  return {
    addedStates: after.states.filter((id) => !beforeStates.has(id)),
    removedStates: before.states.filter((id) => !afterStates.has(id)),
    addedArrows: after.arrows.filter((arrow) => !beforeKeys.has(arrowKey(arrow))),
    removedArrows: before.arrows.filter((arrow) => !afterKeys.has(arrowKey(arrow))),
  };
}

/** True when nothing was added or removed. */
export function isUnchanged(changes: MachineChanges): boolean {
  return (
    changes.addedStates.length === 0 &&
    changes.removedStates.length === 0 &&
    changes.addedArrows.length === 0 &&
    changes.removedArrows.length === 0
  );
}
