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
  /** Worker internal: the run resolved. */
  RUN_SUCCEEDED: EventRef<`${N}.RUN_SUCCEEDED`, void>;
  /** Worker internal: the run rejected or threw. */
  RUN_FAILED: EventRef<`${N}.RUN_FAILED`, { error: string }>;
  /** App → inbox: keep `count` workers. Below 1 counts as 1; fractions round down. */
  WORKERS_RESIZED: EventRef<`${N}.WORKERS_RESIZED`, { count: number }>;
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
  /**
   * Keep `count` workers. Growing adds free workers that take waiting items at once.
   * Shrinking removes the highest ids: free ones at once, running ones once they report.
   */
  resize(count: number): void;
}

interface InboxContext<T> {
  /** Items not yet handed out, first in line first. */
  waiting: T[];
  /** Ids of the workers that take work now. */
  free: string[];
  /** Ids of every worker that exists, running ones included. */
  workers: string[];
  /** How many workers to keep: ids `w1`..`w<size>`. A running worker above it leaves when it reports. */
  size: number;
}

/** Event refs for a pool named `name`. `createPool` uses these; call it to type a sender or a test. */
export function poolEvents<T, const N extends string>(name: N): PoolEvents<T, N> {
  return {
    ITEM_ARRIVED: event(`${name}.ITEM_ARRIVED`)<{ item: T }>(),
    ITEMS_ASSIGNED: event(`${name}.ITEMS_ASSIGNED`)<{ worker: string; items: T[] }>(),
    ITEMS_FINISHED: event(`${name}.ITEMS_FINISHED`)<{ worker: string; items: T[] }>(),
    ITEMS_FAILED: event(`${name}.ITEMS_FAILED`)<{ worker: string; items: T[]; error: string }>(),
    RUN_SUCCEEDED: event(`${name}.RUN_SUCCEEDED`)(),
    RUN_FAILED: event(`${name}.RUN_FAILED`)<{ error: string }>(),
    WORKERS_RESIZED: event(`${name}.WORKERS_RESIZED`)<{ count: number }>(),
  };
}

function atLeastOne(value: number): number {
  return Number.isNaN(value) ? 1 : Math.max(1, value);
}

function clampWorkers(count: number): number {
  return Math.floor(atLeastOne(count));
}

function workerId(index: number): string {
  return `w${index}`;
}

/** The number in a worker id: `w3` is 3. */
function indexOf(key: string): number {
  return Number(key.slice(1));
}

interface Shared<T, N extends string> {
  events: PoolEvents<T, N>;
  size: number;
  batch: number;
  setOfKeys: boolean;
  keyOf: (item: T) => string;
  run: PoolOptions<T, N>["run"];
  clock: Clock | undefined;
}

/** Nothing waits and no worker is running. */
const allWorkersFree = state("allWorkersFree")();
/** At least one worker is running and nothing waits. */
const workersBusy = state("workersBusy")();
/** Items wait in line: every worker is running. */
const workWaiting = state("workWaiting")();
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
  return { context: { ...context, waiting, free: spare }, assignments };
}

/** Put `items` ahead of `waiting`; with "set", leave out those whose key already waits. */
function inFront<T, N extends string>(
  shared: Shared<T, N>,
  items: readonly T[],
  waiting: readonly T[],
): T[] {
  const { setOfKeys, keyOf } = shared;
  if (!setOfKeys) return [...items, ...waiting];
  const waits = new Set(waiting.map(keyOf));
  return [...items.filter((item) => !waits.has(keyOf(item))), ...waiting];
}

/** Store the new context and hand out work; says what is left waiting and running. */
function apply<T, N extends string>(
  shared: Shared<T, N>,
  slot: { set(value: InboxContext<T>): void },
  next: InboxContext<T>,
) {
  const { batch, events } = shared;
  const settled = settle({ context: next, batch });
  slot.set(settled.context);
  return {
    waits: settled.context.waiting.length > 0,
    busy: settled.context.free.length < settled.context.workers.length,
    emit: settled.assignments.map((assignment) => events.ITEMS_ASSIGNED.create(assignment)),
  };
}

/** The context after a worker reports: it is free again, and `items` go to the front. */
function afterReport<T, N extends string>(
  shared: Shared<T, N>,
  options: {
    current: InboxContext<T>;
    worker: string;
    items: readonly T[];
  },
): InboxContext<T> {
  const { current, worker, items } = options;
  const running = current.workers.includes(worker) && !current.free.includes(worker);
  if (!running) return current;
  const waiting = inFront(shared, items, current.waiting);
  if (indexOf(worker) > current.size) {
    return { ...current, waiting, workers: current.workers.filter((key) => key !== worker) };
  }
  return { ...current, waiting, free: [...current.free, worker] };
}

/** The context that keeps `count` workers: free ones above it go now, new ones start free. */
function resized<T>(current: InboxContext<T>, count: number): InboxContext<T> {
  if (count > 2 ** 32 - 1) return current;
  const size = clampWorkers(count);
  const wanted = Array.from({ length: size }, (_, index) => workerId(index + 1));
  const kept = current.workers.filter((key) => indexOf(key) <= size || !current.free.includes(key));
  const added = wanted.filter((key) => !kept.includes(key));
  const workers = [...kept, ...added].sort((a, b) => indexOf(a) - indexOf(b));
  const free = [...current.free.filter((key) => kept.includes(key)), ...added];
  return { ...current, workers, free, size };
}

/** Every arrival waits at the back, unless "set" already has its key waiting. */
function arrival<T, N extends string>(
  shared: Shared<T, N>,
  current: InboxContext<T>,
  item: T,
): InboxContext<T> {
  const { setOfKeys, keyOf } = shared;
  const skip = setOfKeys && current.waiting.some((w) => keyOf(w) === keyOf(item));
  return { ...current, waiting: skip ? current.waiting : [...current.waiting, item] };
}

function buildInbox<T, N extends string>(shared: Shared<T, N>) {
  const { events, clock } = shared;
  const ids = Array.from({ length: shared.size }, (_, index) => workerId(index + 1));
  const start: InboxContext<T> = { waiting: [], free: [...ids], workers: ids, size: shared.size };
  return Actor({
    inputs: [
      events.ITEM_ARRIVED,
      events.ITEMS_FINISHED,
      events.ITEMS_FAILED,
      events.WORKERS_RESIZED,
    ],
    outputs: [events.ITEMS_ASSIGNED],
    states: [allWorkersFree, workersBusy, workWaiting],
    initial: allWorkersFree,
    context: start,
    ...(clock && { clock }),
    setup: (m) => {
      /** A free worker always exists, so the item goes straight out. */
      m.on(allWorkersFree, {
        event: events.ITEM_ARRIVED,
        to: [workersBusy],
        handler: ({ payload }, { context }) => {
          const next = apply(shared, context, arrival(shared, context.get(), payload.item));
          return { state: workersBusy, emit: next.emit };
        },
      });
      /** The item waits only if no worker is free. */
      m.on(workersBusy, {
        event: events.ITEM_ARRIVED,
        to: [workersBusy, workWaiting],
        handler: ({ payload }, { context }) => {
          const next = apply(shared, context, arrival(shared, context.get(), payload.item));
          return { state: next.waits ? workWaiting : workersBusy, emit: next.emit };
        },
      });
      /** Every worker is running, so the item joins the line. */
      m.on(workWaiting, {
        event: events.ITEM_ARRIVED,
        to: [workWaiting],
        handler: ({ payload }, { context }) => {
          const next = apply(shared, context, arrival(shared, context.get(), payload.item));
          return { state: workWaiting, emit: next.emit };
        },
      });
      /** A running worker is free again. An id that is free or unknown changes nothing. */
      m.on(workersBusy, {
        event: events.ITEMS_FINISHED,
        to: [allWorkersFree, workersBusy],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const done = afterReport(shared, { current, worker: payload.worker, items: [] });
          const next = apply(shared, context, done);
          return { state: next.busy ? workersBusy : allWorkersFree, emit: next.emit };
        },
      });
      /** The freed worker takes the front of the line at once. */
      m.on(workWaiting, {
        event: events.ITEMS_FINISHED,
        to: [workWaiting, workersBusy],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const done = afterReport(shared, { current, worker: payload.worker, items: [] });
          const next = apply(shared, context, done);
          return { state: next.waits ? workWaiting : workersBusy, emit: next.emit };
        },
      });
      /** Failed items go to the front; the freed worker or another free one takes them. */
      m.on(workersBusy, {
        event: events.ITEMS_FAILED,
        to: [workersBusy, workWaiting],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const next = apply(
            shared,
            context,
            afterReport(shared, { current, worker: payload.worker, items: payload.items }),
          );
          return { state: next.waits ? workWaiting : workersBusy, emit: next.emit };
        },
      });
      m.on(workWaiting, {
        event: events.ITEMS_FAILED,
        to: [workWaiting, workersBusy],
        handler: ({ payload }, { context }) => {
          const current = context.get();
          const next = apply(
            shared,
            context,
            afterReport(shared, { current, worker: payload.worker, items: payload.items }),
          );
          return { state: next.waits ? workWaiting : workersBusy, emit: next.emit };
        },
      });
      /** Keep `count` workers; new free ones take waiting items at once. */
      const resizeFrom = [
        { from: allWorkersFree, to: [allWorkersFree] },
        { from: workersBusy, to: [workersBusy] },
        { from: workWaiting, to: [workWaiting, workersBusy] },
      ];
      for (const { from, to } of resizeFrom) {
        m.on(from, {
          event: events.WORKERS_RESIZED,
          to,
          handler: ({ payload }, { context }) => {
            const next = apply(shared, context, resized(context.get(), payload.count));
            if (next.waits) return { state: workWaiting, emit: next.emit };
            return { state: next.busy ? workersBusy : allWorkersFree, emit: next.emit };
          },
        });
      }
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
    outputs: [events.ITEMS_FINISHED, events.ITEMS_FAILED],
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
  const shared: Shared<T, N> = {
    events: poolEvents<T, N>(options.name),
    size: clampWorkers(options.workers),
    batch: Math.floor(atLeastOne(options.batch ?? 1)), // Infinity stays Infinity
    setOfKeys: options.keep === "set",
    keyOf: options.key ?? ((item: T) => JSON.stringify(item)),
    run: options.run,
    clock: options.clock,
  };
  const inbox = buildInbox(shared);
  const workers = createActorMap((key) => {
    const worker = buildWorker({ shared, workerId: key });
    // Only the worker's three declared outputs reach here, and the inbox takes all three.
    onOutput(worker, (out) => inbox.send(out as never));
    return worker;
  });
  /** Make the map hold exactly the workers the inbox lists. A leaving worker is killed once the inbox no longer lists it. */
  function reconcile(): void {
    const listed = inbox.snapshot().context.workers;
    for (const key of listed) if (!workers.has(key)) workers.spawn(key);
    for (const key of workers.keys()) {
      if (listed.includes(key)) continue;
      workers.kill(key);
    }
  }
  reconcile();
  inbox.on("change", { fn: reconcile });
  onOutput(inbox, (out) => {
    // The inbox's only output is ITEMS_ASSIGNED, which always carries its worker.
    const { worker } = (out as { payload: { worker: string } }).payload;
    reconcile();
    workers.send(worker, out as never);
  });
  return {
    actor: inbox,
    workers,
    events: shared.events,
    resize: (count) => inbox.send(shared.events.WORKERS_RESIZED.create({ count })),
  };
}
