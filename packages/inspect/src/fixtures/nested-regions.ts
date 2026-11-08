/** A root and a region that both handle `go`, a nested region whose output the root handles under the sub region's input name (`ping`), a region with an internal event, a throwing handler, an effect, and a nested region. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const ready = state("ready")();
const running = state("running")();
const subA = state("a")();
const subB = state("b")();

const go = event("go")();
const boom = event("boom")();
const tick = event("tick")();
const ping = event("ping")();
const pong = event("pong")();

export function createNestedRegionsActor({ clock = VirtualClock(), ran = [] as string[] } = {}) {
  const sub = Actor({
    clock,
    inputs: [ping],
    outputs: [pong],
    states: [subA, subB],
    initial: subA,
    setup: (m) => {
      m.on(subA, {
        event: ping,
        to: [subB],
        handler: () => ({ state: subB, emit: [pong.create()] }),
      });
    },
  });
  const worker = Actor({
    clock,
    inputs: [go, boom],
    outputs: [ping],
    internal: [tick, pong],
    states: [ready, running],
    initial: ready,
    regions: { sub },
    setup: (m) => {
      m.on(ready, { event: go, to: [running], handler: () => ({ state: running }) });
      m.on(ready, {
        event: boom,
        to: [running],
        handler: () => {
          throw new Error("worker exploded");
        },
      });
      m.on(ready, {
        event: pong,
        to: [ready],
        handler: () => ({ state: ready, emit: [ping.create()] }),
      });
      m.effect(running, {
        name: "work",
        sends: [],
        fn: () => {
          ran.push("work");
        },
      });
      m.on(running, { event: tick, to: [ready], handler: () => ({ state: ready }) });
    },
  });
  return Actor({
    clock,
    inputs: [go],
    internal: [ping],
    states: [idle, done],
    initial: idle,
    regions: { worker },
    setup: (m) => {
      m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
      m.on(idle, { event: ping, to: [done], handler: () => ({ state: done }) });
    },
  });
}
