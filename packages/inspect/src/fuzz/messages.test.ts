import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { VizStep } from "@mantaq/viz";
import { onOutput } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";
import { createCheckout } from "../fixtures/lost-message.ts";
import { createRenamedCheckout } from "../fixtures/renamed-wire.ts";
import { fuzz } from "./fuzz.ts";
import { execute } from "./run.ts";
import { fuzzedMachine } from "./to-viz.ts";

const click: VizStep = { kind: "event", event: "PAY_CLICKED", payload: null };
const charged: VizStep = {
  kind: "event",
  event: "CARD_CHARGED",
  payload: null,
  actor: { region: "payment" },
};
const wait: VizStep = { kind: "event", event: "WAITED_TOO_LONG", payload: null };

const renamed = {
  id: "renamedCheckout",
  create: () => {
    const made = createRenamedCheckout();
    return { actor: made.actor, clock: VirtualClock(), made };
  },
};

const started = { from: "waitingForPayment", event: "START", to: "payment.ready" };

test("a renamed wire is recorded with the sender's state and the receiver's state", () => {
  const trace = execute(renamed, [click]);
  expect(trace.sends).toEqual([started]);
  expect(trace.features).toContain("send:waitingForPayment>START>payment.ready");
});

test("the reply and the message into an any-state handler are recorded", () => {
  expect(execute(renamed, [click, charged]).sends).toEqual([
    started,
    { from: "paid", event: "ORDER_CLOSED", to: "payment.ready" },
    { from: "payment.ready", event: "PAYMENT_CONFIRMED", to: "waitingForPayment" },
  ]);
});

test("an output nothing wires is not recorded", () => {
  const sends = execute(renamed, [click, wait]).sends;
  expect(sends.filter((sent) => sent.event === "PAYMENT_TIMED_OUT")).toEqual([]);
});

test("the fuzzer's own step is not a message", () => {
  const step: VizStep = {
    kind: "event",
    event: "START",
    payload: null,
    actor: { region: "payment" },
  };
  expect(execute(renamed, [step]).sends).toEqual([]);
});

test("a wire sent while an entry effect emits at once names the right state", () => {
  const idle = state("idle")();
  const busy = state("busy")();
  const rested = state("rested")();
  const go = event("GO")();
  const ping = event("PING")();
  const done = event("DONE")();
  const ready = state("ready")();
  const pinged = state("pinged")();
  const clock = VirtualClock();
  const b = Actor({
    inputs: [ping],
    states: [ready, pinged],
    initial: ready,
    clock,
    setup: (m) => {
      m.on(ready, { event: ping, to: [pinged], handler: () => ({ state: pinged }) });
    },
  });
  const a = Actor({
    inputs: [go],
    internal: [done],
    outputs: [ping],
    states: [idle, busy, rested],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: go,
        to: [busy],
        handler: () => ({ state: busy, emit: [ping.create()] }),
      });
      m.effect(busy, { name: "finish", sends: [done], fn: ({ emit }) => emit(done.create()) });
      m.on(busy, { event: done, to: [rested], handler: () => ({ state: rested }) });
    },
  });
  onOutput(a, (out) => {
    if (ping.is(out)) b.send(ping.create());
  });
  const target = { id: "a", create: () => ({ actor: a, clock, made: { b } }) };
  expect(execute(target, [{ kind: "event", event: "GO", payload: null }]).sends).toEqual([
    { from: "busy", event: "PING", to: "b.ready" },
  ]);
});

test("the document lists each wire of the renamed checkout once, sorted", () => {
  const initial = [[click, charged]];
  const machine = fuzzedMachine(renamed, fuzz(renamed, { seed: 1, iterations: 2000, initial }));
  expect(machine.fuzz?.messages).toEqual([
    { from: "paid", event: "ORDER_CLOSED", to: "payment.*" },
    { from: "payment.ready", event: "PAYMENT_CONFIRMED", to: "waitingForPayment" },
    started,
  ]);
});

test("a message the lost-message checkout sends is listed with the arrow that took it", () => {
  const lost = {
    id: "checkout",
    create: () => {
      const made = createCheckout();
      return { actor: made.actor, clock: VirtualClock(), made };
    },
  };
  const initial = [[click, wait]];
  const machine = fuzzedMachine(lost, fuzz(lost, { seed: 1, iterations: 2000, initial }));
  expect(machine.fuzz?.messages).toEqual([
    { from: "gaveUp", event: "PAYMENT_TIMED_OUT", to: "payment.charging" },
    { from: "waitingForPayment", event: "PAYMENT_STARTED", to: "payment.ready" },
  ]);
});

const idle = state("idle")();
const done = state("done")();
const go = event("GO")();
const ping = event("PING")();
const pong = event("PONG")();

function listener(inputs: Array<typeof ping | typeof pong>, clock: VirtualClock) {
  return Actor({
    inputs,
    states: [idle, done],
    initial: idle,
    clock,
    setup: (m) => {
      for (const input of inputs)
        m.on(idle, { event: input, to: [done], handler: () => ({ state: done }) });
    },
  });
}

test("a machine that sends to itself records no message", () => {
  const clock = VirtualClock();
  const a = Actor({
    inputs: [go, ping],
    outputs: [ping],
    states: [idle, done],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: go,
        to: [idle],
        handler: () => ({ state: idle, emit: [ping.create()] }),
      });
      m.on(idle, { event: ping, to: [done], handler: () => ({ state: done }) });
    },
  });
  onOutput(a, (out) => {
    if (ping.is(out)) a.send(ping.create());
  });
  const target = { id: "a", create: () => ({ actor: a, clock, made: {} }) };
  expect(execute(target, [{ kind: "event", event: "GO", payload: null }]).sends).toEqual([]);
});

test("a reply to a message is recorded next to the message it answers", () => {
  const clock = VirtualClock();
  const a = Actor({
    inputs: [go, pong],
    outputs: [ping],
    states: [idle, done],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: go,
        to: [idle],
        handler: () => ({ state: idle, emit: [ping.create()] }),
      });
      m.on(idle, { event: pong, to: [done], handler: () => ({ state: done }) });
    },
  });
  const b = Actor({
    inputs: [ping],
    outputs: [pong],
    states: [idle, done],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: ping,
        to: [done],
        handler: () => ({ state: done, emit: [pong.create()] }),
      });
    },
  });
  onOutput(a, (out) => {
    if (ping.is(out)) b.send(ping.create());
  });
  onOutput(b, (out) => {
    if (pong.is(out)) a.send(pong.create());
  });
  const target = { id: "a", create: () => ({ actor: a, clock, made: { b } }) };
  expect(execute(target, [{ kind: "event", event: "GO", payload: null }]).sends).toEqual([
    { from: "b.done", event: "PONG", to: "idle" },
    { from: "idle", event: "PING", to: "b.idle" },
  ]);
});

test("messages are sorted by sender state, then event, then receiver", () => {
  function create() {
    const clock = VirtualClock();
    const b = listener([pong], clock);
    const c = listener([ping], clock);
    const a = Actor({
      inputs: [go],
      outputs: [ping, pong],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, {
          event: go,
          to: [idle],
          handler: () => ({ state: idle, emit: [ping.create(), pong.create()] }),
        });
      },
    });
    onOutput(a, (out) => {
      if (ping.is(out)) c.send(ping.create());
      if (pong.is(out)) b.send(pong.create());
    });
    return { actor: a, clock, made: { b, c } };
  }
  const target = { id: "a", create };
  const machine = fuzzedMachine(
    target,
    fuzz(target, {
      seed: 1,
      iterations: 50,
      initial: [[{ kind: "event", event: "GO", payload: null }]],
    }),
  );
  expect(machine.fuzz?.messages).toEqual([
    { from: "idle", event: "PING", to: "c.idle" },
    { from: "idle", event: "PONG", to: "b.idle" },
  ]);
});

test("a receiver that moves again while it answers is recorded at the arrow that took the message", () => {
  const answer = event("ANSWER")();
  const waiting = state("waiting")();
  const clock = VirtualClock();
  function create() {
    const c = Actor({
      inputs: [pong],
      outputs: [answer],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, {
          event: pong,
          to: [idle],
          handler: () => ({ state: idle, emit: [answer.create()] }),
        });
      },
    });
    const b = Actor({
      inputs: [ping, answer],
      outputs: [pong],
      states: [idle, waiting, done],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, {
          event: ping,
          to: [waiting],
          handler: () => ({ state: waiting, emit: [pong.create()] }),
        });
        m.on(waiting, { event: answer, to: [done], handler: () => ({ state: done }) });
      },
    });
    const a = Actor({
      inputs: [go],
      outputs: [ping],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, {
          event: go,
          to: [idle],
          handler: () => ({ state: idle, emit: [ping.create()] }),
        });
      },
    });
    onOutput(a, (out) => {
      if (ping.is(out)) b.send(ping.create());
    });
    onOutput(b, (out) => {
      if (pong.is(out)) c.send(pong.create());
    });
    onOutput(c, (out) => {
      if (answer.is(out)) b.send(answer.create());
    });
    return { actor: a, clock, made: { b, c } };
  }
  expect(
    execute({ id: "a", create }, [{ kind: "event", event: "GO", payload: null }]).sends,
  ).toEqual([
    { from: "c.idle", event: "ANSWER", to: "b.waiting" },
    { from: "b.waiting", event: "PONG", to: "c.idle" },
    { from: "idle", event: "PING", to: "b.idle" },
  ]);
});

test("a message sent from the receiver's entry effect does not take over the one being received", () => {
  const mid = state("mid")();
  const next = event("NEXT")();
  function create() {
    const clock = VirtualClock();
    const c = listener([pong], clock);
    const b = Actor({
      inputs: [ping],
      internal: [next],
      outputs: [pong],
      states: [idle, mid, done],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: ping, to: [mid], handler: () => ({ state: mid }) });
        m.effect(mid, { name: "tell", sends: [next], fn: ({ emit }) => emit(next.create()) });
        m.on(mid, {
          event: next,
          to: [done],
          handler: () => ({ state: done, emit: [pong.create()] }),
        });
      },
    });
    const a = Actor({
      inputs: [go],
      outputs: [ping],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, {
          event: go,
          to: [idle],
          handler: () => ({ state: idle, emit: [ping.create()] }),
        });
      },
    });
    onOutput(a, (out) => {
      if (ping.is(out)) b.send(ping.create());
    });
    onOutput(b, (out) => {
      if (pong.is(out)) c.send(pong.create());
    });
    return { actor: a, clock, made: { b, c } };
  }
  expect(
    execute({ id: "a", create }, [{ kind: "event", event: "GO", payload: null }]).sends,
  ).toEqual([
    { from: "b.done", event: "PONG", to: "c.idle" },
    { from: "idle", event: "PING", to: "b.idle" },
  ]);
});
