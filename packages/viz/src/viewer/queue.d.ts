import type { VizJson, VizMachine } from "../schema.ts";
/** What a pool's inbox shows: how many wait and the first ones as text, first in line first. */
export interface Queue {
  count: number;
  /** At most 50 entries. */
  items: string[];
}
/** A pool's inbox (sugar `createPool`): an actor map plus a context with exactly sugar's InboxContext fields. */
export declare function hasQueue(machine: VizMachine): boolean;
/** The waiting items of a pool's inbox; `{ count: 0, items: [] }` when the machine has no queue or `waiting` is not an array. */
export declare function queueOf(machine: VizMachine, context: VizJson): Queue;
