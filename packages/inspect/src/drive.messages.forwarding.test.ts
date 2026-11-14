import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { onOutput } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";

const go = event("GO")();
const ping = event("PING")();
const kick = event("KICK")();
const idle = state("idle")();
const first = state("first")();
const s1 = state("s1")();

test("two parts that each forward PING in one step are each named as the sender", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const maker = () =>
        Actor({
          inputs: [kick],
          outputs: [ping],
          states: [s1],
          initial: s1,
          clock,
          setup: (m) => {
            m.on(s1, { event: kick, handler: () => ({ emit: [ping.create()] }) });
          },
        });
      const a = maker();
      const b = maker();
      const c = Actor({
        inputs: [ping],
        states: [s1],
        initial: s1,
        clock,
        setup: (m) => {
          m.on(s1, { event: ping, to: [s1], handler: () => ({ state: s1 }) });
        },
      });
      const root = Actor({
        inputs: [go],
        outputs: [kick],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, {
            event: go,
            to: [idle],
            handler: () => ({ state: idle, emit: [kick.create()] }),
          });
        },
      });
      onOutput(root, (out) => {
        a.send(out as never);
        b.send(out as never);
      });
      onOutput(a, (out) => c.send(out as never));
      onOutput(b, (out) => c.send(out as never));
      return { actor: root, clock, made: { actor: root, a, b, c } };
    },
  });
  const live = driver.step({ kind: "event", event: "GO", payload: {} });
  expect(
    live.after.filter((e) => e.event === "PING").map((e) => [e.actor, e.message?.sender]),
  ).toEqual([
    [{ region: "c" }, "a"],
    [{ region: "c" }, "b"],
  ]);
});

test("a region step's event that the root passes on to another part is recorded as a message", () => {
  const driver = createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const r = Actor({
        inputs: [go],
        outputs: [ping],
        states: [s1],
        initial: s1,
        clock,
        setup: (m) => {
          m.on(s1, { event: go, handler: () => ({ emit: [ping.create()] }) });
        },
      });
      const other = Actor({
        inputs: [go],
        states: [s1],
        initial: s1,
        clock,
        setup: (m) => {
          m.on(s1, { event: go, to: [s1], handler: () => ({ state: s1 }) });
        },
      });
      const root = Actor({
        inputs: [],
        internal: [ping],
        outputs: [go],
        states: [idle],
        initial: idle,
        clock,
        regions: { r },
        setup: (m) => {
          m.on(idle, { event: ping, handler: () => ({ emit: [go.create()] }) });
        },
      });
      onOutput(root, (out) => other.send(out as never));
      return { actor: root, clock, made: { actor: root, other } };
    },
  });
  const live = driver.step({ kind: "event", event: "GO", payload: {}, actor: { region: "r" } });
  expect(
    live.after
      .filter((e) => e.message !== undefined)
      .map((e) => [e.actor, e.event, e.message?.sender]),
  ).toEqual([[{ region: "other" }, "GO", ""]]);
});

const twoParts = () =>
  createDriver({
    id: "a",
    create: () => {
      const clock = VirtualClock();
      const a = Actor({
        inputs: [kick],
        outputs: [ping],
        states: [s1],
        initial: s1,
        clock,
        setup: (m) => {
          m.on(s1, { event: kick, handler: () => ({ emit: [ping.create()] }) });
        },
      });
      const c = Actor({
        inputs: [ping],
        outputs: [ping],
        states: [s1, first],
        initial: s1,
        clock,
        setup: (m) => {
          m.on(s1, {
            event: ping,
            to: [first],
            handler: () => ({ state: first, emit: [ping.create()] }),
          });
          m.on(first, { event: ping, to: [first], handler: () => ({ state: first }) });
        },
      });
      const root = Actor({
        inputs: [go],
        states: [idle],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, { event: go, to: [idle], handler: () => ({ state: idle }) });
        },
      });
      root.on("transition", { fn: () => c.send(ping.create() as never) });
      return { actor: root, clock, made: { actor: root, a, c } };
    },
  });

test("a message sent by app code in a later step is not named after a part heard in an earlier step", () => {
  const driver = twoParts();
  driver.step({ kind: "event", event: "KICK", payload: {}, actor: { region: "a" } });
  const live = driver.step({ kind: "event", event: "GO", payload: {} });
  expect(
    live.after.filter((e) => e.message !== undefined).map((e) => [e.actor, e.message?.sender]),
  ).toEqual([[{ region: "c" }, null]]);
});
