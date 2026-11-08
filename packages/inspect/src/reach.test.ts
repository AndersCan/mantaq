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

const evA = event("a")<{ x: number; z: number }>();
const evB = event("b")<{ y: number }>();

function createTwoActor() {
  return Actor({
    clock: VirtualClock(),
    inputs: [evA, evB],
    states: [idle],
    initial: idle,
    setup: (m) => {
      m.on(idle, {
        event: evA,
        to: [idle],
        handler: (e) => (e.payload.x + e.payload.z > 0 ? {} : {}),
      });
      m.on(idle, { event: evB, to: [idle], handler: (e) => (e.payload.y > 0 ? {} : {}) });
    },
  });
}

const target = { id: "flow", create: () => createActor(), fuzz: { iterations: 300 } };
const structureOnly = { id: "flow", create: () => createActor(), fuzz: false as const };
const goOnly = [{ name: "go", steps: [{ kind: "event" as const, event: "go", payload: null }] }];

const lockOn = event("lockSet")<{ lockOn: boolean }>();
const off = state("off")();
const on = state("on")();

function createLockActor(handler: (lockOn: boolean | undefined) => boolean) {
  return Actor({
    clock: VirtualClock(),
    inputs: [lockOn],
    states: [off, on],
    initial: off,
    setup: (m) => {
      m.on(off, {
        event: lockOn,
        to: [on, off],
        handler: (e) => ({ state: handler(e.payload.lockOn) ? on : off }),
      });
      m.on(on, { event: lockOn, to: [off], handler: () => ({ state: off }) });
    },
  });
}

const refusal =
  "lock: fuzzing had no payload for 1 event the machine reads, so this check proves nothing yet:\n  - lockSet: read lockOn\nPass `source` (payloads from the event types) or `payloads: { lockSet: [...] }` with a real payload for each case.";
const lockPayloads = { lockSet: [{ lockOn: true }, { lockOn: false }] };

describe("a check whose events were fuzzed without a payload", () => {
  test("a state only an empty payload reaches is the refusal, not a pass", () => {
    const create = () => createLockActor((flag) => flag === false);
    expect(() => expectAllStatesReached({ id: "lock", create })).toThrow(refusal);
    expect(() =>
      expectAllStatesReached({ id: "lock", create, payloads: lockPayloads }),
    ).not.toThrow();
  });

  test("a miss follows the refusal after a blank line", () => {
    const create = () => createLockActor((flag) => flag === true);
    expect(() => expectAllStatesReached({ id: "lock", create })).toThrow(
      new RegExp(
        `^${refusal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n\nlock missed 1 expected reach:`,
      ),
    );
    expect(() =>
      expectAllStatesReached({ id: "lock", create, payloads: lockPayloads }),
    ).not.toThrow();
  });

  test("expectReached stops the same way", () => {
    const create = () => createLockActor((flag) => flag === false);
    expect(() => expectReached({ id: "lock", create }, { states: ["on"] })).toThrow(refusal);
  });

  test("names every event, in event order, when there are several", () => {
    expect(() => expectAllStatesReached({ id: "two", create: createTwoActor })).toThrow(
      "two: fuzzing had no payload for 2 events the machine reads, so this check proves nothing yet:\n  - a: read x, z\n  - b: read y\nPass `source` (payloads from the event types) or `payloads: { a: [...], b: [...] }` with a real payload for each case.",
    );
  });
});

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
