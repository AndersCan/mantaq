import { expect, test, describe } from "vite-plus/test";
import { Actor, isIn, activeLeaves } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

function makeActor() {
  const toggle = event("toggled")();
  const powerOff = event("powerOff")();
  const stateChanged = event("stateChanged")<"on" | "off">();
  const isOff = event("isOff")();
  const retry = event("retry")();

  const empty = state("empty")();
  const off = state("off")();
  const on = state("on")<{ power: number }>();

  const light = new Actor({
    inputs: [toggle, powerOff],
    outputs: [stateChanged, isOff],
    internal: [retry],
    context: { offCounter: 0, onCounter: 0 },
    states: [on, off, empty],
    initial: off,
    effects: {},
    transitions: {
      off: {
        toggled: () => ({ state: on, payload: { power: 2 } }),
      },
      on: {
        toggled: () => ({ state: off }),
        powerOff: () => ({
          state: off,
          payload: { offCounter: 2 },
          emit: [stateChanged.create("off")],
        }),
      },
    },
  });

  return { light, toggle, powerOff, stateChanged, isOff, retry, empty, off, on };
}

describe("snapshot", () => {
  test("flat state — path is [stateName], regions is empty", () => {
    const { light } = makeActor();
    const snap = light.snapshot();

    expect(snap).toEqual({ path: ["off"], regions: {} });
  });

  test("flat state — after transition", () => {
    const { light, toggle } = makeActor();
    light.send(toggle);
    const snap = light.snapshot();

    expect(snap).toEqual({ path: ["on"], regions: {} });
  });

  test("hierarchical — single region", () => {
    const idle = state("idle")();
    const active = state("active")();
    const connected = state("connected")().regions({
      default: { initial: "idle", states: { idle, active } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [connected],
      initial: connected,
      effects: {},
      transitions: {},
    });

    const snap = actor.snapshot();
    expect(snap).toEqual({
      path: ["connected"],
      regions: {
        default: { path: ["idle"], regions: {} },
      },
    });
  });

  test("parallel — multiple regions", () => {
    const playing = state("playing")();
    const paused = state("paused")();
    const muted = state("muted")();
    const unmuted = state("unmuted")();

    const player = state("player")().regions({
      playback: { initial: "playing", states: { playing, paused } },
      audio: { initial: "muted", states: { muted, unmuted } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [player],
      initial: player,
      effects: {},
      transitions: {},
    });

    const snap = actor.snapshot();
    expect(snap).toEqual({
      path: ["player"],
      regions: {
        playback: { path: ["playing"], regions: {} },
        audio: { path: ["muted"], regions: {} },
      },
    });
  });

  test("nested regions — deep path", () => {
    const level1 = state("level1")();
    const level2 = state("level2")().regions({
      default: { initial: "level1", states: { level1 } },
    });
    const root = state("root")().regions({
      default: { initial: "level2", states: { level2 } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [root],
      initial: root,
      effects: {},
      transitions: {},
    });

    const snap = actor.snapshot();
    expect(snap).toEqual({
      path: ["root"],
      regions: {
        default: {
          path: ["level2"],
          regions: {
            default: { path: ["level1"], regions: {} },
          },
        },
      },
    });
  });
});

describe("effects", () => {
  test("effect runs on state transition", () => {
    let effectRan = false;
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          ({ signal: _signal }) => {
            effectRan = true;
          },
        ],
      },
      transitions: {
        off: {
          toggled: () => ({ state: on }),
        },
      },
    });

    actor.send(toggle);
    expect(effectRan).toBe(true);
  });

  test("effect can emit internal events", () => {
    const load = event("load")<{ url: string }>();
    const fetchSuccess = event("fetchSuccess")<{ data: string }>();
    const fetchError = event("fetchError")<{ error: string }>();

    const idle = state("idle")();
    const loading = state("loading")();
    const success = state("success")<{ data: string }>();
    const failed = state("failed")<{ error: string }>();

    const fetchedData = { data: "hello" };

    const actor = new Actor({
      inputs: [load],
      outputs: [],
      internal: [fetchSuccess, fetchError],
      context: {},
      states: [idle, loading, success, failed],
      initial: idle,
      effects: {
        loading: [
          ({ emit }) => {
            emit(fetchSuccess.create(fetchedData));
          },
        ],
      },
      transitions: {
        idle: {
          load: () => ({ state: loading }),
        },
        loading: {
          fetchSuccess: () => ({ state: success }),
          fetchError: () => ({ state: failed }),
        },
      },
    });

    actor.send(load.create({ url: "/api/data" }));
    expect(actor.state.name).toBe("success");
  });

  test("emit in transition result processes internal events", () => {
    const toggle = event("toggled")();
    const internalEvent = event("internal")();
    const off = state("off")();
    const on = state("on")();
    let internalProcessed = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [internalEvent],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: on, emit: [internalEvent.create({})] }),
        },
        on: {
          internal: () => {
            internalProcessed = true;
            return { state: off };
          },
        },
      },
    });

    actor.send(toggle);
    expect(internalProcessed).toBe(true);
    expect(actor.state.name).toBe("off");
  });
});

describe("isIn", () => {
  test("flat — exact match", () => {
    const { light } = makeActor();
    expect(isIn(light.snapshot(), "off")).toBe(true);
    expect(isIn(light.snapshot(), "on")).toBe(false);
  });

  test("hierarchical — ancestor match", () => {
    const idle = state("idle")();
    const active = state("active")();
    const connected = state("connected")().regions({
      default: { initial: "idle", states: { idle, active } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [connected],
      initial: connected,
      effects: {},
      transitions: {},
    });

    expect(isIn(actor.snapshot(), "connected")).toBe(true);
    expect(isIn(actor.snapshot(), "idle")).toBe(true);
    expect(isIn(actor.snapshot(), "active")).toBe(false);
  });

  test("unknown state returns false", () => {
    const { light } = makeActor();
    expect(isIn(light.snapshot(), "unknown")).toBe(false);
  });
});

describe("activeLeaves", () => {
  test("flat — returns current path", () => {
    const { light } = makeActor();
    expect(activeLeaves(light.snapshot())).toEqual(["off"]);
  });

  test("hierarchical — returns leaf through region", () => {
    const idle = state("idle")();
    const active = state("active")();
    const connected = state("connected")().regions({
      default: { initial: "idle", states: { idle, active } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [connected],
      initial: connected,
      effects: {},
      transitions: {},
    });

    expect(activeLeaves(actor.snapshot())).toEqual(["connected.default.idle"]);
  });

  test("parallel — returns all leaves", () => {
    const paused = state("paused")();
    const playing = state("playing")();
    const unmuted = state("unmuted")();
    const player = state("player")().regions({
      playback: { initial: "paused", states: { paused, playing } },
      audio: { initial: "unmuted", states: { unmuted } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [player],
      initial: player,
      effects: {},
      transitions: {},
    });

    expect(activeLeaves(actor.snapshot())).toEqual([
      "player.playback.paused",
      "player.audio.unmuted",
    ]);
  });
});

describe("matches", () => {
  test("flat state — exact match", () => {
    const { light } = makeActor();
    expect(light.matches("off")).toBe(true);
    expect(light.matches("on")).toBe(false);
  });

  test("flat state — after transition", () => {
    const { light, toggle } = makeActor();
    light.send(toggle);
    expect(light.matches("on")).toBe(true);
    expect(light.matches("off")).toBe(false);
  });

  test("hierarchical — prefix match", () => {
    const idle = state("idle")();
    const active = state("active")();
    const connected = state("connected")().regions({
      default: { initial: "idle", states: { idle, active } },
    });

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [connected],
      initial: connected,
      effects: {},
      transitions: {},
    });

    expect(actor.matches("connected.default.idle")).toBe(true);
    expect(actor.matches("connected.default.active")).toBe(false);
    expect(actor.matches("connected")).toBe(true);
  });

  test("empty pattern returns false", () => {
    const { light } = makeActor();
    expect(light.matches("")).toBe(false);
  });

  test("trailing dot returns false", () => {
    const { light } = makeActor();
    expect(light.matches("off.")).toBe(false);
  });
});
