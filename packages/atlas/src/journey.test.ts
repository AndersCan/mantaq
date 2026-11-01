import { toAtlasMachine } from "./atlas.ts";
import { exampleJourneys, exampleTargets } from "./examples.ts";
import type { Example } from "./examples.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { withJourneys } from "./journey.ts";
import type { AtlasMachine } from "./schema.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

function example(id: string): Example {
  const found = exampleTargets().find((each) => each.id === id);
  if (found === undefined) return expect.unreachable(`no example ${id}`);
  return found;
}

function recorded(id: string): AtlasMachine {
  const target = example(id);
  const machine = toAtlasMachine({ id, actor: target.create().actor });
  const result = withJourneys(target, machine, exampleJourneys()[id] ?? []);
  expect(Either.isRight(result)).toBe(true);
  return Either.isRight(result) ? result[1] : machine;
}

const idle = state("idle")();
const waiting = state("waiting")();
const done = state("done")().final();
const start = event("start")();
const timedOut = event("timedOut")();

/** `waiting` arms a timer on entry: an `advance` input makes the effect move the actor. */
function timerTarget(): FuzzTarget {
  return {
    id: "timer",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [start],
        internal: [timedOut],
        states: [idle, waiting, done],
        initial: idle,
        clock,
        setup: (m) => {
          m.effect(waiting, {
            name: "armTimer",
            fn: (input) => {
              withTimeout(100, { input, event: () => timedOut.create() });
            },
          });
          m.on(idle, { event: start, to: [waiting], handler: () => ({ state: waiting }) });
          m.on(waiting, { event: timedOut, to: [done], handler: () => ({ state: done }) });
        },
      });
      return { actor, clock };
    },
  };
}

describe("withJourneys", () => {
  test("records each move on a drawn edge, with the effects entering it ran", () => {
    const machine = recorded("checkout");
    const declined = machine.journeys.find((journey) => journey.id === "card-declined");
    expect(declined?.start).toBe("basicInfo");
    expect(declined?.title).toBe("How we handle a declined card");
    expect(
      declined?.moves.map(
        (move) => `${move.from}>${move.event}>${move.to}:${move.effects.join(",")}`,
      ),
    ).toEqual([
      "basicInfo>submitBasicInfo>shippingAddress:",
      "shippingAddress>submitShipping>payment:",
      "payment>submitPayment>submitting:chargeCard",
      "submitting>paymentFail>error:",
      "error>back>payment:",
    ]);
    const edgeIds = new Set(machine.edges.map((edge) => edge.id));
    for (const move of declined?.moves ?? []) expect(edgeIds.has(move.edge ?? "")).toBe(true);
    expect(declined?.inputs[3]?.note).toBe("chargeCard reports the card was declined.");
  });

  test("a stay is recorded as such, on the edge that handled it", () => {
    const machine = recorded("auth");
    const tick = machine.journeys
      .find((journey) => journey.id === "sign-out")
      ?.moves.find((move) => move.event === "MONITOR_TICK");
    expect(tick?.outcome).toBe("stay");
    expect(machine.edges.find((edge) => edge.id === tick?.edge)?.from).toBe("*");
  });

  test("an unhandled input is an ignored move, not a guessed edge", () => {
    const target = example("checkout");
    const machine = toAtlasMachine({ id: "checkout", actor: target.create().actor });
    const result = withJourneys(target, machine, [
      {
        id: "back-at-start",
        title: "Back on the first step",
        inputs: [{ step: { kind: "event", event: "back", payload: null } }],
      },
    ]);
    const move = Either.isRight(result) ? result[1].journeys[0]?.moves[0] : undefined;
    expect(move).toEqual({
      input: 0,
      from: "basicInfo",
      event: "back",
      to: "basicInfo",
      outcome: "ignored",
      edge: null,
      effects: [],
    });
    expect(Either.isRight(result) ? result[1].journeys[0]?.description : "").toBeNull();
  });

  test("time passing moves the actor through the effect's own event", () => {
    const target = timerTarget();
    const machine = toAtlasMachine({ id: "timer", actor: target.create().actor });
    expect(machine.states.find((each) => each.id === "waiting")?.effects).toEqual(["armTimer"]);
    const result = withJourneys(target, machine, [
      {
        id: "times-out",
        title: "How we time out",
        inputs: [
          { step: { kind: "event", event: "start", payload: null }, note: "Start waiting." },
          { step: { kind: "advance", ms: 100 }, note: "Nobody answers." },
        ],
      },
    ]);
    const moves = Either.isRight(result) ? result[1].journeys[0]?.moves : [];
    expect(moves?.map((move) => [move.input, move.event, move.to, move.effects])).toEqual([
      [0, "start", "waiting", ["armTimer"]],
      [1, "timedOut", "done", []],
    ]);
  });

  test("every example journey replays on the exported machine", () => {
    for (const id of Object.keys(exampleJourneys())) {
      expect(recorded(id).journeys.length).toBeGreaterThan(0);
    }
  });
});
