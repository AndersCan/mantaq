import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { VizStep } from "@mantaq/viz";
import { onOutput } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";
import { execute } from "./run.ts";

const idle = state("idle")();
const go = event("GO")();
const ping = event("PING")();
const lostOne = event("LOST_ONE")();
const fire = event("FIRE")();

function create() {
  const clock = VirtualClock();
  const b = Actor({
    inputs: [ping],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: ping, to: [idle], handler: () => ({ state: idle }) });
    },
  });
  const c = Actor({
    inputs: [ping],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: ping, to: [idle], handler: () => ({ state: idle }) });
    },
  });
  const a = Actor({
    inputs: [go],
    internal: [fire],
    outputs: [ping, lostOne],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: go,
        to: [idle],
        handler: () => ({ state: idle, emit: [ping.create(), lostOne.create()] }),
      });
      m.on(idle, {
        event: fire,
        to: [idle],
        handler: () => ({ state: idle, emit: [ping.create(), lostOne.create()] }),
      });
    },
  });
  onOutput(a, (out) => (out.type === "PING" ? b.send(out as never) : c.send(out as never)));
  return { actor: a, b, c, clock };
}

const target = {
  id: "a",
  create: () => {
    const made = create();
    return { actor: made.actor, clock: made.clock, made };
  },
};

test("the second of two outputs from an injected event is sent by the machine that emitted them", () => {
  const steps: VizStep[] = [{ kind: "event", event: "FIRE", payload: null }];
  expect(execute(target, steps).lost).toEqual([
    { sender: "a", receiver: "c", event: "LOST_ONE", step: 0 },
  ]);
});

test("the second of two outputs is sent by the machine that emitted them, not the one the first reached", () => {
  const steps: VizStep[] = [{ kind: "event", event: "GO", payload: null }];
  expect(execute(target, steps).lost).toEqual([
    { sender: "a", receiver: "c", event: "LOST_ONE", step: 0 },
  ]);
});
