import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { onOutput } from "@mantaq/sugar";
import type { VizActorRef, VizJson, VizStep } from "@mantaq/viz";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createDroppedMessage } from "./fixtures/dropped-message.ts";
import { createKitchen } from "./fixtures/kitchen.ts";

const send = (name: string, options: { payload?: VizJson; actor?: VizActorRef } = {}): VizStep => ({
  kind: "event",
  event: name,
  payload: options.payload ?? {},
  ...(options.actor === undefined ? {} : { actor: options.actor }),
});

const dishes = () =>
  createDriver({
    id: "kitchen",
    create: () => {
      const clock = VirtualClock();
      const made = createDroppedMessage({ clock });
      return { actor: made.actor, clock, made };
    },
  });

test("a message the waiter takes names the kitchen as sender, and the step itself has none", () => {
  const live = dishes().step(send("DISH_COOKED"));
  expect(live.last?.message).toBeUndefined();
  expect(live.after).toEqual([
    expect.objectContaining({
      actor: { region: "waiter" },
      event: "DISH_READY",
      from: "waiter.serving",
      to: "waiter.carryingDish",
      outcome: "transition",
      message: { sender: "", dropped: null },
    }),
  ]);
});

test("a message the waiter has no handler for is an ignored entry dropped as noHandler", () => {
  const driver = dishes();
  driver.step(send("BREAK_STARTED", { actor: { region: "waiter" } }));
  const live = driver.step(send("DISH_COOKED"));
  expect(live.after).toEqual([
    expect.objectContaining({
      actor: { region: "waiter" },
      event: "DISH_READY",
      from: "waiter.onBreak",
      to: "waiter.onBreak",
      outcome: "ignored",
      effects: [],
      error: null,
      message: { sender: "", dropped: "noHandler" },
    }),
  ]);
});

test("the person's own step to the waiter carries no message, even when it is ignored", () => {
  const driver = dishes();
  driver.step(send("BREAK_STARTED", { actor: { region: "waiter" } }));
  const live = driver.step(send("DISH_READY", { actor: { region: "waiter" } }));
  expect(live.last).toEqual(expect.objectContaining({ outcome: "ignored" }));
  expect(live.last?.message).toBeUndefined();
  expect(live.after).toEqual([]);
});

const kitchen = (effectMode: "held" | "real") =>
  createDriver(
    {
      id: "kitchen",
      create: () => {
        const clock = VirtualClock();
        const made = createKitchen({ clock });
        return { actor: made.actor, clock, made };
      },
    },
    { effectMode },
  );
const order = send("ORDER_PLACED", { payload: { dish: "soup" } });

test("a pool: waiting orders are taken, and each message names its sender", () => {
  const driver = kitchen("held");
  const first = driver.step(order);
  expect(first.after.map((entry) => [entry.actor, entry.message])).toEqual([
    [{ region: "orders" }, { sender: "", dropped: null }],
    [
      { map: "cooks", key: "w1" },
      { sender: "orders", dropped: null },
    ],
  ]);
  driver.step(order);
  const third = driver.step(order);
  expect(third.after.map((entry) => [entry.to, entry.message])).toEqual([
    ["orders.workWaiting", { sender: "", dropped: null }],
  ]);
});

test("a pool: a cook that finishes reports to the inbox, which hands over the waiting dish", () => {
  const driver = kitchen("held");
  for (const _ of [1, 2, 3]) driver.step(order);
  const live = driver.step(send("orders.RUN_SUCCEEDED", { actor: { map: "cooks", key: "w1" } }));
  expect(live.after.map((entry) => [entry.actor, entry.message])).toEqual([
    [
      { map: "cooks", key: "w1" },
      { sender: "orders", dropped: null },
    ],
    [{ region: "orders" }, { sender: "cooks", dropped: null }],
  ]);
});

const start = event("START")();
const ping = event("PING")();
const pong = event("PONG")();
const idle = state("idle")();

test("a receiver that sends during its own handler is not named as the sender of its own message", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const b = Actor({
        inputs: [ping],
        outputs: [pong],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, { event: ping, handler: () => ({ emit: [pong.create()] }) });
        },
      });
      const a = Actor({
        inputs: [start, pong],
        outputs: [ping],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, { event: start, handler: () => ({ emit: [ping.create()] }) });
          m.on(idle, { event: pong, handler: () => ({}) });
        },
      });
      onOutput(a, (out) => b.send(out as never));
      onOutput(b, (out) => a.send(out as never));
      return { actor: a, clock, made: { actor: a, b } };
    },
  });
  const live = driver.step(send("START"));
  expect(live.after.map((entry) => [entry.event, entry.message])).toEqual([
    ["PING", { sender: "", dropped: null }],
    ["PONG", { sender: "b", dropped: null }],
  ]);
});

const go = event("GO")();
const tick = event("TICK")();
const first = state("first")();
const second = state("second")();
const third = state("third")();

test("a receiver whose own effect moves it first still has the message on the entry for the event", () => {
  const driver = createDriver(
    {
      id: "a",
      create: () => {
        const clock = VirtualClock();
        const target = Actor({
          inputs: [ping],
          internal: [tick],
          states: [first, second, third],
          initial: first,
          clock,
          setup: (m) => {
            m.on(first, { event: ping, to: [second], handler: () => ({ state: second }) });
            m.effect(second, {
              name: "tick",
              sends: [tick],
              fn: async ({ emit }) => emit(tick.create()),
            });
            m.on(second, { event: tick, to: [third], handler: () => ({ state: third }) });
          },
        });
        const root = Actor({
          inputs: [go],
          outputs: [ping],
          states: [idle],
          initial: idle,
          clock,
          setup: (m) => {
            m.on(idle, { event: go, handler: () => ({ emit: [ping.create()] }) });
          },
        });
        onOutput(root, (out) => target.send(out as never));
        return { actor: root, clock, made: { actor: root, target } };
      },
    },
    { effectMode: "real" },
  );
  const live = driver.step(send("GO"));
  expect(live.after.map((entry) => [entry.event, entry.message])).toEqual([
    ["TICK", undefined],
    ["PING", { sender: "", dropped: null }],
  ]);
});

test("a receiver that sends itself the same event while handling it keeps each message on its own entry", () => {
  const driver = createDriver(
    {
      id: "a",
      create: () => {
        const clock = VirtualClock();
        let again = false;
        const target: ReturnType<typeof Actor> = Actor({
          inputs: [ping],
          states: [first, second],
          initial: first,
          clock,
          setup: (m) => {
            m.on(first, { event: ping, to: [second], handler: () => ({ state: second }) });
            m.on(second, { event: ping, to: [second], handler: () => ({ state: second }) });
            m.effect(second, {
              name: "again",
              sends: [],
              fn: () => {
                if (again) return;
                again = true;
                target.send(ping.create() as never);
              },
            });
          },
        });
        const root = Actor({
          inputs: [go],
          outputs: [ping],
          states: [idle],
          initial: idle,
          clock,
          setup: (m) => {
            m.on(idle, { event: go, handler: () => ({ emit: [ping.create()] }) });
          },
        });
        onOutput(root, (out) => target.send(out as never));
        return { actor: root, clock, made: { actor: root, target } };
      },
    },
    { effectMode: "real" },
  );
  const live = driver.step(send("GO"));
  expect(live.after.map((entry) => [entry.from, entry.to, entry.message])).toEqual([
    ["target.second", "target.second", { sender: "", dropped: null }],
    ["target.first", "target.second", { sender: "", dropped: null }],
  ]);
});

const step1 = state("step1")();

test("a message sent back to the machine that is being stepped is a message, not the step", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const other = Actor({
        inputs: [ping],
        outputs: [go],
        states: [step1],
        initial: step1,
        clock,
        setup: (m) => {
          m.on(step1, { event: ping, handler: () => ({ emit: [go.create()] }) });
        },
      });
      const root = Actor({
        inputs: [go],
        outputs: [ping],
        states: [idle, first],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, {
            event: go,
            to: [first],
            handler: () => ({ state: first, emit: [ping.create()] }),
          });
          m.on(first, { event: go, to: [first], handler: () => ({ state: first }) });
        },
      });
      onOutput(root, (out) => other.send(out as never));
      onOutput(other, (out) => root.send(out as never));
      return { actor: root, clock, made: { actor: root, other } };
    },
  });
  const live = driver.step(send("GO"));
  expect(live.last?.message).toBeUndefined();
  expect(live.after.map((entry) => [entry.actor, entry.event, entry.message?.sender])).toEqual([
    [{ region: "other" }, "PING", ""],
    [undefined, "GO", "other"],
  ]);
});

test("a message the machine itself has no handler for is dropped, with its own state name", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const caller = Actor({
        inputs: [go],
        outputs: [ping],
        states: [step1],
        initial: step1,
        clock,
        setup: (m) => {
          m.on(step1, { event: go, handler: () => ({ emit: [ping.create()] }) });
        },
      });
      const root = Actor({
        inputs: [ping],
        states: [idle],
        initial: idle,
        clock,
        setup: () => {},
      });
      onOutput(caller, (out) => root.send(out as never));
      return { actor: root, clock, made: { actor: root, caller } };
    },
  });
  const live = driver.step(send("GO", { actor: { region: "caller" } }));
  expect(live.after).toEqual([
    expect.objectContaining({
      from: "idle",
      to: "idle",
      outcome: "ignored",
      message: { sender: "caller", dropped: "noHandler" },
    }),
  ]);
  expect(live.after[0]).not.toHaveProperty("actor");
});

test("stepping a machine that sends itself the same event keeps the step's own entry free of a message", () => {
  const driver = createDriver(
    {
      id: "a",
      create: () => {
        const clock = VirtualClock();
        let again = false;
        const target: ReturnType<typeof Actor> = Actor({
          inputs: [ping],
          states: [first, second],
          initial: first,
          clock,
          setup: (m) => {
            m.on(first, { event: ping, to: [second], handler: () => ({ state: second }) });
            m.on(second, { event: ping, to: [second], handler: () => ({ state: second }) });
            m.effect(second, {
              name: "again",
              sends: [],
              fn: () => {
                if (again) return;
                again = true;
                target.send(ping.create() as never);
              },
            });
          },
        });
        const root = Actor({ inputs: [go], states: [idle], initial: idle, clock, setup: () => {} });
        return { actor: root, clock, made: { actor: root, target } };
      },
    },
    { effectMode: "real" },
  );
  const live = driver.step(send("PING", { actor: { region: "target" } }));
  expect(live.last).toEqual(expect.objectContaining({ from: "target.first", to: "target.second" }));
  expect(live.last?.message).toBeUndefined();
  expect(live.after.map((entry) => entry.message)).toEqual([{ sender: null, dropped: null }]);
});

test("a sender named in a later step does not change a message an earlier step reported", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const target = Actor({
        inputs: [ping],
        states: [step1],
        initial: step1,
        clock,
        setup: (m) => {
          m.on(step1, { event: ping, to: [step1], handler: () => ({ state: step1 }) });
        },
      });
      const root = Actor({
        inputs: [go],
        outputs: [ping],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, { event: go, handler: () => ({ emit: [ping.create()] }) });
        },
      });
      onOutput(root, (out) => target.send(out as never));
      clock.setTimeout(10, { cb: () => target.send(ping.create() as never) });
      return { actor: root, clock, made: { actor: root, target } };
    },
  });
  const timed = driver.step({ kind: "advance", ms: 10 });
  expect(timed.last?.message).toEqual({ sender: null, dropped: null });
  driver.step(send("GO"));
  expect(timed.last?.message).toEqual({ sender: null, dropped: null });
});

const hop1 = event("HOP1")();
const hop2 = event("HOP2")();

test("a chain of three parts names each sender by the event it sent", () => {
  const link = (input: typeof hop1 | typeof hop2, output: typeof hop2 | null) =>
    Actor({
      inputs: [input],
      outputs: output === null ? [] : [output],
      states: [step1],
      initial: step1,
      setup: (m) => {
        m.on(step1, {
          event: input,
          handler: () => (output === null ? {} : { emit: [output.create()] }),
        });
      },
    });
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const middle = link(hop1, hop2);
      const last = link(hop2, null);
      const root = Actor({
        inputs: [go],
        outputs: [hop1],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, { event: go, handler: () => ({ emit: [hop1.create()] }) });
        },
      });
      onOutput(root, (out) => middle.send(out as never));
      onOutput(middle, (out) => last.send(out as never));
      return { actor: root, clock, made: { actor: root, middle, last } };
    },
  });
  const live = driver.step(send("GO"));
  expect(live.after.map((entry) => [entry.event, entry.message])).toEqual([
    ["HOP1", { sender: "", dropped: null }],
    ["HOP2", { sender: "middle", dropped: null }],
  ]);
});

test("a message with no known sender is not named by an output of another event", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const target = Actor({
        inputs: [ping],
        states: [step1],
        initial: step1,
        clock,
        setup: (m) => {
          m.on(step1, { event: ping, to: [step1], handler: () => ({ state: step1 }) });
        },
      });
      const root = Actor({
        inputs: [go],
        outputs: [hop1],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, {
            event: go,
            to: [idle],
            handler: () => ({ state: idle, emit: [hop1.create()] }),
          });
        },
      });
      clock.setTimeout(10, { cb: () => target.send(ping.create() as never) });
      clock.setTimeout(20, { cb: () => root.send(go.create()) });
      return { actor: root, clock, made: { actor: root, target } };
    },
  });
  const live = driver.step({ kind: "advance", ms: 20 });
  const messages = [live.last, ...live.after].map((entry) => [
    entry?.event,
    entry?.message?.sender,
  ]);
  expect(messages).toContainEqual(["PING", null]);
});
