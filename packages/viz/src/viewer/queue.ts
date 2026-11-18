import type { VizJson, VizMachine } from "../schema.ts";

const QUEUE_TEXTS = 50;
const INBOX_FIELDS = ["free", "size", "waiting", "workers"];

/** What a pool's inbox shows: how many wait and the first ones as text, first in line first. */
export interface Queue {
  count: number;
  /** At most 50 entries. */
  items: string[];
}

/** A pool's inbox (sugar `createPool`): an actor map plus a context with exactly sugar's InboxContext fields. */
export function hasQueue(machine: VizMachine): boolean {
  const names = (machine.context ?? []).map((field) => field.name).sort();
  if (names.length !== INBOX_FIELDS.length) return false;
  if (!names.every((name, index) => name === INBOX_FIELDS[index])) return false;
  return machine.maps.length > 0;
}

function textOf(item: VizJson): string {
  return typeof item === "string" ? item : JSON.stringify(item);
}

/** The waiting items of a pool's inbox; `{ count: 0, items: [] }` when the machine has no queue or `waiting` is not an array. */
export function queueOf(machine: VizMachine, context: VizJson): Queue {
  const none = { count: 0, items: [] };
  if (!hasQueue(machine)) return none;
  if (typeof context !== "object" || context === null || Array.isArray(context)) return none;
  const waiting = context["waiting"];
  if (!Array.isArray(waiting)) return none;
  return { count: waiting.length, items: waiting.slice(0, QUEUE_TEXTS).map(textOf) };
}
