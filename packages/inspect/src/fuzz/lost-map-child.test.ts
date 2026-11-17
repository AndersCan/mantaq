import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { VizStep } from "@mantaq/viz";
import { createActorMap, onOutput } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";
import { execute } from "./run.ts";

const idle = state("idle")();
const go = event("GO")();
const order = event("ORDER")();
const done = event("DONE")();
const noted = event("NOTED")();

function create() {
  const clock = VirtualClock();
  const ledger = Actor({
    inputs: [noted],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: noted, to: [idle], handler: () => ({ state: idle }) });
    },
  });
  const cooks = createActorMap((id) => {
    const cook = Actor({
      inputs: [order],
      outputs: [done],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, {
          event: order,
          to: [idle],
          handler: () => ({ state: idle, emit: [done.create()] }),
        });
      },
    });
    void id;
    onOutput(cook, (out) => ledger.send(out as never));
    return cook;
  });
  cooks.spawn("c1");
  const boss = Actor({
    inputs: [go],
    outputs: [order],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: go,
        to: [idle],
        handler: () => ({ state: idle, emit: [order.create()] }),
      });
    },
  });
  onOutput(boss, (out) => cooks.send("c1", out as never));
  return { actor: boss, ledger, cooks, clock };
}

test("a map child's lost send is not pinned on the machine that fed the child", () => {
  const steps: VizStep[] = [{ kind: "event", event: "GO", payload: null }];
  const lost = execute(
    {
      id: "boss",
      create: () => {
        const c = create();
        return { actor: c.actor, clock: c.clock, made: c };
      },
    },
    steps,
  ).lost;
  expect(lost).toEqual([{ sender: "cooks", receiver: "ledger", event: "DONE", step: 0 }]);
});
