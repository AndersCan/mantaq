import { onOutput } from "./output.ts";
import { createActorMap } from "./actors/actor-map.ts";
import type { ActorMap } from "./actors/actor-map.ts";
import { withPromise } from "./effects/promise.ts";
import { Actor, event, state } from "@mantaq/core";
import type { Clock, EventRef } from "@mantaq/core";

/** The seven events of a pool, every id prefixed with the pool's name. */
export interface PoolEvents<T, N extends string> {
  /** App → inbox: one item to hand out. */
  ITEM_ARRIVED: EventRef<`${N}.ITEM_ARRIVED`, { item: T }>;
  /** Inbox → worker: items to run. */
  ITEMS_ASSIGNED: EventRef<`${N}.ITEMS_ASSIGNED`, { worker: string; items: T[] }>;
  /** Worker → inbox: the run resolved. */
  ITEMS_FINISHED: EventRef<`${N}.ITEMS_FINISHED`, { worker: string; items: T[] }>;
  /** Worker → inbox: the run rejected or threw. */
  ITEMS_FAILED: EventRef<`${N}.ITEMS_FAILED`, { worker: string; items: T[]; error: string }>;
  /** Worker → inbox: the worker was busy, so it hands the items back. */
  ITEMS_RETURNED: EventRef<`${N}.ITEMS_RETURNED`, { worker: string; items: T[] }>;
  /** Worker internal: the run resolved. */
  RUN_SUCCEEDED: EventRef<`${N}.RUN_SUCCEEDED`, void>;
  /** Worker internal: the run rejected or threw. */
  RUN_FAILED: EventRef<`${N}.RUN_FAILED`, { error: string }>;
}

export interface PoolOptions<T, N extends string> {
  /** Prefix of every event id: `${name}.ITEM_ARRIVED`. Two pools in one app need different names. */
  name: N;
  /** How many workers, keyed `w1`..`wn`. Below 1 counts as 1; fractions round down. */
  workers: number;
  /** Does one assignment. Resolve: done. Reject or throw: the items go back to the front of the inbox. */
  run: (items: readonly T[], options: { signal: AbortSignal }) => Promise<void>;
  /** "queue" (default): every arrival waits, in order. "set": an item whose key already waits is not added again. */
  keep?: "queue" | "set";
  /** Identity for "set". Default: JSON.stringify. */
  key?: (item: T) => string;
  /** Most items one worker takes at once. Default 1. Infinity: all that wait. Below 1 counts as 1. */
  batch?: number;
  clock?: Clock;
}

export interface Pool<T, N extends string> {
  /** The inbox. Send `events.ITEM_ARRIVED` here. */
  actor: ReturnType<typeof buildInbox<T, N>>;
  /** The workers `w1`..`wn`. */
  workers: ActorMap;
  events: PoolEvents<T, N>;
}

interface InboxContext<T> {
  /** Items not yet handed out, first in line first. */
  waiting: T[];
  /** Ids of the workers that take work now. */
  free: string[];
}

/** Event refs for a pool named `name`. `createPool` uses these; call it to type a sender or a test. */
export function poolEvents<T, const N extends string>(name: N): PoolEvents<T, N> {
  return {
    ITEM_ARRIVED: event(`${name}.ITEM_ARRIVED`)<{ item: T }>(),
    ITEMS_ASSIGNED: event(`${name}.ITEMS_ASSIGNED`)<{ worker: string; items: T[] }>(),
    ITEMS_FINISHED: event(`${name}.ITEMS_FINISHED`)<{ worker: string; items: T[] }>(),
    ITEMS_FAILED: event(`${name}.ITEMS_FAILED`)<{ worker: string; items: T[]; error: string }>(),
    ITEMS_RETURNED: event(`${name}.ITEMS_RETURNED`)<{ worker: string; items: T[] }>(),
    RUN_SUCCEEDED: event(`${name}.RUN_SUCCEEDED`)(),
    RUN_FAILED: event(`${name}.RUN_FAILED`)<{ error: string }>(),
  };
}

function atLeastOne(value: number): number {
  return Number.isNaN(value) ? 1 : Math.max(1, value);
}

interface Shared<T, N extends string> {
  events: PoolEvents<T, N>;
  ids: string[];
  batch: number;
  setOfKeys: boolean;
  keyOf: (item: T) => string;
  run: PoolOptions<T, N>["run"];
  clock: Clock | undefined;
}

const empty = state("empty")();
const holding = state("holding")();
const free = state("free")();
const working = state("working")();

/** Hand the first waiting items to the first free worker, until one side runs out. */
function settle<T>(options: { context: InboxContext<T>; batch: number }) {
  const { context, batch } = options;
  const waiting = [...context.waiting];
  const spare = [...context.free];
  const assignments: Array<{ worker: string; items: T[] }> = [];
  while (waiting.length > 0) {
    const worker = spare.shift();
    if (worker === undefined) break;
    assignments.push({ worker, items: waiting.splice(0, batch) });
  }
  return { context: { waiting, free: spare }, assignments };
}

function buildInbox<T, N extends string>(shared: Shared<T, N>) {
  const { events, ids, batch, setOfKeys, keyOf, clock } = shared;
  const known = new Set(ids);

  /** Put `items` ahead of `waiting`; with "set", leave out those whose key already waits. */
  function inFront(items: readonly T[], waiting: readonly T[]): T[] {
    if (!setOfKeys) return [...items, ...waiting];
    const waits = new Set(waiting.map(keyOf));
    return [...items.filter((item) => !waits.has(keyOf(item))), ...waiting];
  }

  /** Store the new context, hand out work, and settle in `holding` if anything still waits. */
  function apply(slot: { set(value: InboxContext<T>): void }, next: InboxContext<T>) {
    const settled = settle({ context: next, batch });
    slot.set(settled.context);
    return {
      state: settled.context.waiting.length > 0 ? holding : empty,
      emit: settled.assignments.map((assignment) => events.ITEMS_ASSIGNED.create(assignment)),
    };
  }

  const start: InboxContext<T> = { waiting: [], free: [...ids] };
  return Actor({
    inputs: [
      events.ITEM_ARRIVED,
      events.ITEMS_FINISHED,
      events.ITEMS_FAILED,
      events.ITEMS_RETURNED,
    ],
    outputs: [events.ITEMS_ASSIGNED],
    states: [empty, holding],
    initial: empty,
    context: start,
    ...(clock && { clock }),
    setup: (m) => {
      /** Every arrival waits at the back, unless "set" already has its key waiting. */
      m.onAny({
        event: events.ITEM_ARRIVED,
        to: [empty, holding],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const skip = setOfKeys && current.waiting.some((w) => keyOf(w) === keyOf(payload.item));
          return apply(context, {
            ...current,
            waiting: skip ? current.waiting : [...current.waiting, payload.item],
          });
        },
      });
      /** A busy worker is free again. An id that is free or unknown changes nothing. */
      m.onAny({
        event: events.ITEMS_FINISHED,
        to: [empty, holding],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const busy = known.has(payload.worker) && !current.free.includes(payload.worker);
          return apply(
            context,
            busy ? { ...current, free: [...current.free, payload.worker] } : current,
          );
        },
      });
      /** Failed items go to the front; a busy worker is free again. */
      m.onAny({
        event: events.ITEMS_FAILED,
        to: [empty, holding],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const busy = known.has(payload.worker) && !current.free.includes(payload.worker);
          if (!busy) return apply(context, current);
          return apply(context, {
            waiting: inFront(payload.items, current.waiting),
            free: [...current.free, payload.worker],
          });
        },
      });
      /** A busy worker refused: its items go to the front and it stays busy. */
      m.onAny({
        event: events.ITEMS_RETURNED,
        to: [empty, holding],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          if (!known.has(payload.worker)) return apply(context, current);
          return apply(context, { ...current, waiting: inFront(payload.items, current.waiting) });
        },
      });
    },
  });
}

function buildWorker<T, N extends string>(options: { shared: Shared<T, N>; workerId: string }) {
  const { shared, workerId } = options;
  const { events, run, clock } = shared;
  const idle: { items: T[] } = { items: [] };
  return Actor({
    inputs: [events.ITEMS_ASSIGNED],
    internal: [events.RUN_SUCCEEDED, events.RUN_FAILED],
    outputs: [events.ITEMS_FINISHED, events.ITEMS_FAILED, events.ITEMS_RETURNED],
    states: [free, working],
    initial: free,
    context: idle,
    ...(clock && { clock }),
    setup: (m) => {
      /** Take the assignment and start the run. */
      m.on(free, {
        event: events.ITEMS_ASSIGNED,
        to: [working],
        handler: ({ payload }, { context }) => {
          context.set({ items: payload.items });
          return { state: working };
        },
      });
      /** Already running: hand the items back instead of dropping them. */
      m.on(working, {
        event: events.ITEMS_ASSIGNED,
        handler: ({ payload }) => ({
          emit: [events.ITEMS_RETURNED.create({ worker: workerId, items: payload.items })],
        }),
      });
      /** Run the items; a synchronous throw counts as a failure. */
      m.effect(working, {
        name: "runItems",
        sends: [events.RUN_SUCCEEDED, events.RUN_FAILED],
        fn: ({ context, signal, emit }) =>
          withPromise({
            promise: Promise.resolve().then(() => run(context.get().items, { signal })),
            signal,
            emit,
            events: {
              success: () => events.RUN_SUCCEEDED.create(),
              error: (err) => events.RUN_FAILED.create({ error: String(err) }),
            },
          }),
      });
      /** The run resolved: report the items done and take work again. */
      m.on(working, {
        event: events.RUN_SUCCEEDED,
        to: [free],
        handler: (_event, { context }) => {
          const items = context.get().items;
          context.set({ items: [] });
          return { state: free, emit: [events.ITEMS_FINISHED.create({ worker: workerId, items })] };
        },
      });
      /** The run rejected: report the items failed and take work again. */
      m.on(working, {
        event: events.RUN_FAILED,
        to: [free],
        handler: ({ payload }, { context }) => {
          const items = context.get().items;
          context.set({ items: [] });
          return {
            state: free,
            emit: [events.ITEMS_FAILED.create({ worker: workerId, items, error: payload.error })],
          };
        },
      });
    },
  });
}

/**
 * One inbox and n workers that pull from it. The inbox hands items to free
 * workers only; failed items go back to the front. Disposing loses waiting
 * items: keeping them is the app's job.
 */
export function createPool<T, const N extends string>(options: PoolOptions<T, N>): Pool<T, N> {
  const count = Math.floor(atLeastOne(options.workers));
  const shared: Shared<T, N> = {
    events: poolEvents<T, N>(options.name),
    ids: Array.from({ length: count }, (_, index) => `w${index + 1}`),
    batch: Math.floor(atLeastOne(options.batch ?? 1)), // Infinity stays Infinity
    setOfKeys: options.keep === "set",
    keyOf: options.key ?? ((item: T) => JSON.stringify(item)),
    run: options.run,
    clock: options.clock,
  };
  const inbox = buildInbox(shared);
  const workers = createActorMap((workerId) => {
    const worker = buildWorker({ shared, workerId });
    // Only the worker's three declared outputs reach here, and the inbox takes all three.
    onOutput(worker, (out) => inbox.send(out as never));
    return worker;
  });
  for (const workerId of shared.ids) workers.spawn(workerId);
  onOutput(inbox, (out) => {
    // The inbox's only output is ITEMS_ASSIGNED, which always carries its worker.
    const { worker } = (out as { payload: { worker: string } }).payload;
    workers.send(worker, out as never);
  });
  return { actor: inbox, workers, events: shared.events };
}
