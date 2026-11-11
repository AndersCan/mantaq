import { Actor, event, state } from "./index.ts";
import { describe, expect, test } from "vite-plus/test";

describe("an input no state handles", () => {
  const idle = state("idle")();
  const poke = event("poke")();
  const stray = event("stray")();

  test("is dropped: state, context and listeners stay untouched", () => {
    const actor = Actor({
      inputs: [poke, stray],
      states: [idle],
      initial: idle,
      context: { count: 0 },
      setup: (m) => {
        m.on(idle, { event: poke, handler: () => ({}) });
      },
    });
    const heard: string[] = [];
    actor.on("transition", { fn: () => heard.push("transition") });
    actor.on("change", { fn: () => heard.push("change") });
    actor.on("output", { fn: () => heard.push("output") });
    actor.on("error", { fn: () => heard.push("error") });
    heard.length = 0; // a new listener is told the current snapshot once
    const before = actor.snapshot();

    actor.send(stray.create());

    expect(actor.snapshot()).toEqual(before);
    expect(heard).toEqual([]);
  });
});

describe("onAny next to a state handler", () => {
  const first = state("first")();
  const second = state("second")();
  const third = state("third")();
  const go = event("go")();
  const fromState = event("fromState")();
  const fromAny = event("fromAny")();

  function build(stateHandlerMoves: boolean) {
    const seen: string[] = [];
    const actor = Actor({
      inputs: [go],
      outputs: [fromState, fromAny],
      states: [first, second, third],
      initial: first,
      context: { log: [] as string[] },
      setup: (m) => {
        m.on(first, {
          event: go,
          to: [second],
          handler: () =>
            stateHandlerMoves
              ? { state: second, emit: [fromState.create()] }
              : { emit: [fromState.create()] },
        });
        m.onAny({
          event: go,
          to: [third],
          handler: (_event, { context, state: current }) => {
            seen.push(current.name);
            context.set({ log: [...context.get().log, "any"] });
            return { state: third, emit: [fromAny.create()] };
          },
        });
      },
    });
    const outputs: string[] = [];
    actor.on("output", { fn: (out) => outputs.push(out.type) });
    return { actor, seen, outputs };
  }

  test("runs after a moving state handler and sees the new state", () => {
    const { actor, seen } = build(true);
    actor.send(go.create());
    expect(seen).toEqual(["second"]);
  });

  test("keeps its context write and emit when the state handler moved, but not its move", () => {
    const { actor, outputs } = build(true);
    actor.send(go.create());
    expect({
      state: actor.state.name,
      log: actor.snapshot().context.log,
      outputs,
    }).toEqual({ state: "second", log: ["any"], outputs: ["fromState", "fromAny"] });
  });

  test("moves when the state handler stayed", () => {
    const { actor, seen, outputs } = build(false);
    actor.send(go.create());
    expect({ state: actor.state.name, seen, outputs }).toEqual({
      state: "third",
      seen: ["first"],
      outputs: ["fromState", "fromAny"],
    });
  });
});
