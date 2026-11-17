import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { onOutput } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";
import { inspect } from "../inspect.ts";

const idle = state("idle")();
const go = event("GO")();
const known = event("KNOWN")();
const yell = event("Y_EVENT")();
const zap = event("Z_EVENT")();
const ant = event("A_EVENT")();

function create() {
  const clock = VirtualClock();
  const quiet = () =>
    Actor({
      inputs: [known],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: known, to: [idle], handler: () => ({ state: idle }) });
      },
    });
  const b = quiet();
  const c = quiet();
  const a = Actor({
    inputs: [go],
    outputs: [zap, yell, ant],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: go,
        to: [idle],
        handler: () => ({ state: idle, emit: [zap.create(), yell.create(), ant.create()] }),
      });
    },
  });
  onOutput(a, (out) => (out.type !== "Y_EVENT" ? b.send(out as never) : c.send(out as never)));
  return { actor: a, b, c, clock };
}

test("lost messages are sorted by sender, then receiver, then event", () => {
  const found = inspect({ id: "a", create }).lostMessages.map(
    ({ sender, receiver, event: name }) => `${sender} ${receiver} ${name}`,
  );
  expect(found).toEqual(["a b A_EVENT", "a b Z_EVENT", "a c Y_EVENT"]);
});
