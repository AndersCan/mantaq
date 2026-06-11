import { expect, test, describe } from "vite-plus/test";
import { Actor } from "../src/actor.ts";
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
      regions: {},
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
      regions: {},
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
      regions: {},
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

  test("emit fires exactly once when state and emit both present", () => {
    const start = event("start")();
    const next = event("next")();
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    let bEntry = 0;

    const actor = new Actor({
      inputs: [start],
      outputs: [],
      internal: [next],
      context: {},
      states: [a, b, c],
      initial: a,
      effects: {
        b: [
          () => {
            bEntry++;
          },
        ],
      },
      transitions: {
        a: {
          start: () => ({ state: b, emit: [next.create({})] }),
        },
        b: {
          next: () => ({ state: c }),
        },
        c: {
          next: () => ({ state: b }),
        },
      },
    });

    actor.send(start);
    expect(bEntry).toBe(1);
    expect(actor.state.name).toBe("c");
  });

  test("send with unmatched event id is silent no-op", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();
    const unknown = event("unknown")();

    const actor = new Actor({
      inputs: [toggle, unknown],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: on }),
        },
        on: {
          toggled: () => ({ state: off }),
        },
      },
    });

    const stateBefore = actor.state.name;
    actor.send(unknown.create({}));
    expect(actor.state.name).toBe(stateBefore);
  });
});

describe("child actors", () => {
  test("parent forwards child output events to internal queue", () => {
    const ping = event("ping")();
    const pong = event("pong")();

    const childIdle = state("childIdle")();
    const childActive = state("childActive")();

    const child = new Actor({
      inputs: [ping],
      outputs: [pong],
      internal: [],
      context: {},
      states: [childIdle, childActive],
      initial: childIdle,
      effects: {},
      transitions: {
        childIdle: {
          ping: () => ({ state: childActive, emit: [pong.create(undefined)] }),
        },
      },
    });

    const parentGo = event("go")();
    const parentIdle = state("parentIdle")();
    const parentActive = state("parentActive")();
    let receivedPong = false;

    const parent = new Actor({
      inputs: [parentGo],
      outputs: [],
      internal: [pong],
      context: {},
      states: [parentIdle, parentActive],
      initial: parentIdle,
      effects: {},
      regions: { childActor: child },
      transitions: {
        parentIdle: {
          go: () => ({ state: parentActive }),
        },
        parentActive: {
          pong: () => {
            receivedPong = true;
            return {};
          },
        },
      },
    });

    parent.send(parentGo);
    child.send(ping);
    expect(receivedPong).toBe(true);
  });

  test("parent snapshot includes child actor snapshots", () => {
    const toggle = event("toggle")();
    const idle = state("idle")();
    const active = state("active")();

    const child = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [idle, active],
      initial: idle,
      effects: {},
      transitions: {
        idle: { toggle: () => ({ state: active }) },
      },
    });

    const parentIdle = state("parentIdle")();
    const parent = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [parentIdle],
      initial: parentIdle,
      effects: {},
      regions: { myChild: child },
      transitions: {},
    });

    const snap = parent.snapshot();
    expect(snap.regions.myChild).toEqual({ path: ["idle"], regions: {} });

    child.send(toggle);
    const snap2 = parent.snapshot();
    expect(snap2.regions.myChild).toEqual({ path: ["active"], regions: {} });
  });
});

describe("internal budget", () => {
  test("stops processing when budget exceeded", () => {
    const internalEvent = event("loop")();
    const trigger = event("trigger")();
    const idle = state("idle")();
    const active = state("active")();

    let emitCount = 0;

    const actor = new Actor({
      inputs: [trigger],
      outputs: [],
      internal: [internalEvent],
      context: {},
      states: [idle, active],
      initial: idle,
      effects: {
        active: [
          ({ emit }) => {
            for (let i = 0; i < 200; i++) {
              emit(internalEvent.create(undefined));
              emitCount++;
            }
          },
        ],
      },
      internalBudget: 50,
      transitions: {
        idle: {
          trigger: () => ({ state: active }),
        },
        active: {
          loop: () => ({}),
        },
      },
    });

    actor.send(trigger);
    expect(emitCount).toBe(200);
    expect(actor.state.name).toBe("active");
  });
});

describe("concurrent send", () => {
  test("sequential sends are processed in order", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { count: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
        on: {
          toggle: () => ({ state: off }),
        },
      },
    });

    actor.send(toggle);
    expect(actor.state.name).toBe("on");
    actor.send(toggle);
    expect(actor.state.name).toBe("off");
    actor.send(toggle);
    expect(actor.state.name).toBe("on");
  });

  test("settled resolves after all sends processed", async () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: { toggle: () => ({ state: on }) },
        on: { toggle: () => ({ state: off }) },
      },
    });

    actor.send(toggle);
    actor.send(toggle);
    await actor.settled();
    expect(actor.state.name).toBe("off");
  });
});
