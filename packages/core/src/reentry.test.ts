import { Actor, state, event } from "./index.ts";
import { expect, test, describe } from "vite-plus/test";

describe("stay versus self-transition", () => {
  const running = state("running")();
  const poke = event("poke")();
  const restart = event("restart")();

  function build(log: string[]) {
    return Actor({
      inputs: [poke, restart],
      states: [running],
      initial: running,
      setup: (m) => {
        m.effect(running, {
          name: "work",
          fn: ({ signal }) => {
            log.push("start");
            signal.addEventListener("abort", () => log.push("abort"));
          },
        });
        m.onAny({ event: poke, handler: () => ({}) });
        m.on(running, { event: restart, to: [running], handler: () => ({ state: running }) });
      },
    });
  }

  test("returning {} keeps the running effect untouched", () => {
    const log: string[] = [];
    const actor = build(log);
    actor.send(poke.create());
    expect(log).toEqual(["start"]);
  });

  test("returning the current state aborts the effect and runs it again", () => {
    const log: string[] = [];
    const actor = build(log);
    actor.send(restart.create());
    expect(log).toEqual(["start", "abort", "start"]);
  });
});
