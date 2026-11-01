import { toVizMachine } from "../structure.ts";
import { createCheckoutActor } from "../fixtures/checkout.ts";
import { createSagaActor } from "../fixtures/saga.ts";
import { decodePath, encodeStep, movesFrom, stateAfter, unhandledSends } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
import { describe, expect, test } from "vite-plus/test";

function checkout(): VizMachine {
  return toVizMachine({ id: "checkout", actor: createCheckoutActor() });
}

function summary(machine: VizMachine, state: string): string[] {
  return movesFrom(machine, state).map(
    (move) => `${move.group} ${move.edge.event} -> ${move.targets.join("|")}`,
  );
}

describe("movesFrom", () => {
  test("groups inputs first, then what the state's effects send", () => {
    const machine = checkout();
    expect(summary(machine, "payment")).toEqual([
      "input back -> shippingAddress",
      "input submitPayment -> submitting",
    ]);
    expect(summary(machine, "submitting")).toEqual([
      "effect paymentFail -> error",
      "effect paymentOk -> success",
      "effect paymentTimeout -> error",
    ]);
    expect(movesFrom(machine, "submitting")[0]?.sentBy).toEqual(["chargeCard"]);
  });

  test("a final state has no moves", () => {
    expect(movesFrom(checkout(), "success")).toEqual([]);
  });

  test("onAny edges are offered from every non-final state, and stays keep the state", () => {
    const saga = toVizMachine({ id: "saga", actor: createSagaActor() });
    expect(summary(saga, "idle")).toEqual([
      "input CANCEL -> compensatingRelease",
      "input CANCEL -> failed",
      "input START -> reservingInventory",
    ]);
    expect(movesFrom(saga, "completed")).toEqual([]);
  });

  test("an internal event no effect of the state declares is grouped as internal", () => {
    const machine = checkout();
    const undeclared: VizMachine = {
      ...machine,
      states: machine.states.map((state) => ({
        ...state,
        effects: state.effects.map((effect) => ({ ...effect, sends: null })),
      })),
    };
    expect(summary(undeclared, "submitting")).toEqual([
      "internal paymentFail -> error",
      "internal paymentOk -> success",
      "internal paymentTimeout -> error",
    ]);
  });
});

describe("unhandledSends", () => {
  test("none for the examples; lists a declared send the state does not handle", () => {
    const machine = checkout();
    expect(machine.states.flatMap((state) => unhandledSends(machine, state.id))).toEqual([]);
    const extra: VizMachine = {
      ...machine,
      states: machine.states.map((state) =>
        state.id === "submitting"
          ? { ...state, effects: [{ name: "chargeCard", sends: ["paymentOk", "refund"] }] }
          : state,
      ),
    };
    expect(unhandledSends(extra, "submitting")).toEqual([
      { effect: "chargeCard", event: "refund" },
    ]);
  });
});

describe("paths", () => {
  test("encode and decode round-trip; stateAfter follows the last step", () => {
    const machine = checkout();
    const first = movesFrom(machine, "basicInfo")[0];
    const step = { edge: first?.edge.id ?? "", to: first?.targets[0] ?? "" };
    expect(stateAfter(machine, [])).toBe("basicInfo");
    expect(stateAfter(machine, [step])).toBe("shippingAddress");
    expect(encodeStep(machine, step)).toBe(step.edge);
    expect(decodePath(machine, [encodeStep(machine, step)])).toEqual([step]);
  });
});
