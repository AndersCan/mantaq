import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { inspect } from "./inspect.ts";
import { expectAllStatesReached, expectReached, missedReach, reachedStates } from "./reach.ts";

const idle = state("idle")();
const running = state("running")();
const done = state("done")();
const go = event("go")();
const finish = event("finish")();

function createActor() {
  return Actor({
    clock: VirtualClock(),
    inputs: [go, finish],
    states: [idle, running, done],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
      m.on(running, { event: finish, to: [done], handler: () => ({ state: done }) });
    },
  });
}

const target = { id: "flow", create: () => createActor(), fuzz: { iterations: 300 } };
const structureOnly = { id: "flow", create: () => createActor(), fuzz: false as const };
const goOnly = [[{ kind: "event" as const, event: "go", payload: null }]];

describe("expectReached", () => {
  test("passes when fuzzing visits the states and transitions", () => {
    expect(() =>
      expectReached(target, {
        states: ["idle", "running", "done"],
        transitions: [
          { from: "idle", event: "go", to: "running" },
          { from: "running", event: "finish" },
        ],
      }),
    ).not.toThrow();
  });

  test("fails with a line per miss when nothing ran", () => {
    expect(() =>
      expectReached(structureOnly, {
        states: ["done"],
        transitions: [{ from: "idle", event: "go", to: "running" }],
      }),
    ).toThrow(
      /missed 2 expected reaches:\n {2}- state done was not reached\n {2}- transition idle --go--> running was not taken/,
    );
  });

  test("example runs count as reaching", () => {
    expect(() =>
      expectReached({ ...structureOnly, tests: goOnly }, { states: ["running"] }),
    ).not.toThrow();
    expect(() => expectReached({ ...structureOnly, tests: goOnly }, { states: ["done"] })).toThrow(
      /state done was not reached/,
    );
  });

  test("names states and transitions that do not exist", () => {
    const { machine } = inspect(structureOnly);
    expect(
      missedReach(machine, {
        states: ["nope"],
        transitions: [
          { from: "idle", event: "go", to: "done" },
          { from: "idle", event: "finish" },
        ],
      }),
    ).toEqual([
      "state nope does not exist",
      "transition idle --go--> done does not exist",
      "transition idle --finish--> does not exist",
    ]);
  });

  test("an empty expectation passes", () => {
    expect(() => expectReached(structureOnly, {})).not.toThrow();
  });
});

describe("expectAllStatesReached", () => {
  test("passes when fuzzing visits every state", () => {
    expect(() => expectAllStatesReached(target)).not.toThrow();
  });

  test("lists the states nothing visited", () => {
    expect(() => expectAllStatesReached({ ...structureOnly, tests: goOnly })).toThrow(
      /missed 1 expected reach:\n {2}- state done was not reached/,
    );
  });
});

describe("reachedStates", () => {
  test("is empty without a run", () => {
    expect(reachedStates(inspect(structureOnly).machine)).toEqual([]);
  });
});
