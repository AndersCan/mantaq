/** `loop` keeps the machine where it is; `boom` enters a state whose effect throws. */
import { Actor, event, machine, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

const idle = state("idle")();
const on = state("on")();
const hot = state("hot")();
const ping = event("ping")();
const loop = event("loop")<{ n: number }>();
const boom = event("boom")();

export const boardWalk = machine("boardWalk", {
  create: ({ clock }) =>
    Actor({
      inputs: [ping, loop, boom],
      internal: [],
      states: [idle, on, hot],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: ping, to: [on], handler: () => ({ state: on }) });
        m.on(on, { event: loop, to: [on], handler: () => ({ state: on }) });
        m.on(on, { event: boom, to: [hot], handler: () => ({ state: hot }) });
        m.effect(hot, {
          name: "explode",
          sends: [],
          fn: () => {
            throw new Error("no fuel");
          },
        });
      },
    }),
});

const quiet = state("quiet")();
const poke = event("poke")();

/** A second machine next to the first, whose handler throws. */
export const boardPair = machine("boardPair", {
  create: ({ clock }) => {
    const helper = Actor({
      inputs: [poke],
      internal: [],
      states: [quiet],
      initial: quiet,
      clock,
      setup: (m) => {
        m.on(quiet, {
          event: poke,
          to: [quiet],
          handler: () => {
            throw new Error("no poke");
          },
        });
      },
    });
    return { actor: boardWalk.create({ clock }), helper };
  },
});

/** Cannot be built without its `need` option. */
export const boardNeeds = machine("boardNeeds", {
  create: ({ clock, need }: { clock: Clock; need?: string }) => {
    if (need === undefined) throw new Error("need is missing");
    return boardWalk.create({ clock });
  },
});

const cooking = state("cooking")();
const serving = state("serving")();
const carrying = state("carrying")();
const cooked = event("cooked")();
const ready = event("ready")();
const served = event("served")();

/** A kitchen whose `cooked` hands the waiter a dish; a waiter with nothing to serve throws. */
export const boardRelay = machine("boardRelay", {
  create: ({ clock }) => {
    const waiter = Actor({
      inputs: [ready, served],
      internal: [],
      states: [serving, carrying],
      initial: serving,
      clock,
      setup: (m) => {
        m.on(serving, { event: ready, to: [carrying], handler: () => ({ state: carrying }) });
        m.on(serving, {
          event: served,
          to: [serving],
          handler: () => {
            throw new Error("nothing to serve");
          },
        });
        m.on(carrying, { event: served, to: [serving], handler: () => ({ state: serving }) });
      },
    });
    const kitchen = Actor({
      inputs: [cooked],
      outputs: [ready],
      states: [cooking],
      initial: cooking,
      clock,
      setup: (m) => {
        m.on(cooking, { event: cooked, handler: () => ({ emit: [ready.create()] }) });
      },
    });
    kitchen.on("output", { fn: (out) => waiter.send(out as never) });
    return { actor: kitchen, waiter };
  },
});
