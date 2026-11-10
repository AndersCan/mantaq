import { assertMatchesModel } from "./match-model.ts";
import { Actor, event, state } from "@mantaq/core";
import * as fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

const MAX = 3;

function counterModel() {
  const increment = event("increment")();
  const decrement = event("decrement")();
  const reset = event("reset")();
  const empty = state("empty")();
  const counting = state("counting")();
  const full = state("full")();
  return Actor({
    inputs: [increment, decrement, reset],
    states: [empty, counting, full],
    initial: empty,
    context: { count: 0 },
    setup: (m) => {
      const bump = (
        context: { get(): { count: number }; set(v: { count: number }): void },
        by: number,
      ) => {
        const count = context.get().count + by;
        context.set({ count });
        return count;
      };
      m.on(empty, {
        event: increment,
        to: [counting],
        handler: (_e, { context }) => {
          bump(context, 1);
          return { state: counting };
        },
      });
      m.on(counting, {
        event: increment,
        to: [counting, full],
        handler: (_e, { context }) => ({ state: bump(context, 1) >= MAX ? full : counting }),
      });
      m.on(counting, {
        event: decrement,
        to: [empty, counting],
        handler: (_e, { context }) => ({ state: bump(context, -1) === 0 ? empty : counting }),
      });
      m.on(full, {
        event: decrement,
        to: [counting],
        handler: (_e, { context }) => {
          bump(context, -1);
          return { state: counting };
        },
      });
      m.onAny({
        event: reset,
        to: [empty],
        handler: (_e, { context }) => {
          context.set({ count: 0 });
          return { state: empty };
        },
      });
    },
  });
}

function counterApp(buggy: boolean) {
  const app = { count: 0 };
  return {
    app,
    increment: () => {
      if (buggy ? app.count <= MAX : app.count < MAX) app.count += 1;
    },
    decrement: () => {
      if (app.count > 0) app.count -= 1;
    },
    reset: () => {
      app.count = 0;
    },
    read: () =>
      app.count === 0
        ? ("empty" as const)
        : app.count >= MAX
          ? ("full" as const)
          : ("counting" as const),
  };
}

function counterOptions(buggy: boolean) {
  return {
    model: counterModel,
    start: () => counterApp(buggy),
    events: {
      increment: (a: ReturnType<typeof counterApp>) => a.increment(),
      decrement: (a: ReturnType<typeof counterApp>) => a.decrement(),
      reset: (a: ReturnType<typeof counterApp>) => a.reset(),
    },
    state: (a: ReturnType<typeof counterApp>) => a.read(),
  };
}

function message(run: () => Promise<void>): Promise<string> {
  return run().then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe("assertMatchesModel", () => {
  test("a correct counter resolves", async () => {
    await expect(assertMatchesModel(counterOptions(false))).resolves.toBeUndefined();
  });

  test("a buggy counter prints the shortest failing steps", async () => {
    expect(await message(() => assertMatchesModel(counterOptions(true)))).toMatchInlineSnapshot(`
      "The app does not match the model after 5 events (seed 107806).
        #  event      model     app
        0  (start)    empty     empty
        1  increment  counting  counting
        2  increment  counting  counting
        3  increment  full      full
        4  increment  full      full      model did not handle it
        5  decrement  counting  full      <- differs
      The app has a bug, or the model is wrong."
    `);
  });

  test("the same options give the same message", async () => {
    const first = await message(() => assertMatchesModel(counterOptions(true)));
    const second = await message(() => assertMatchesModel(counterOptions(true)));
    expect(second).toBe(first);
  });

  test("a global fast-check config does not change the message", async () => {
    const plain = await message(() => assertMatchesModel(counterOptions(true)));
    fc.configureGlobal({ endOnFailure: true, numRuns: 1 });
    try {
      expect(await message(() => assertMatchesModel(counterOptions(true)))).toBe(plain);
    } finally {
      fc.resetConfigureGlobal();
    }
  });

  test("a state outside the model is reported", async () => {
    const msg = await message(() =>
      assertMatchesModel({
        ...counterOptions(false),
        // @ts-expect-error -- "loading" is not a model state
        state: () => "loading",
      }),
    );
    expect(msg).toBe(
      `state(app) failed after 0 events (seed 107806): returned "loading", which is not a model state (empty, counting, full)
  #  event    model  app
  0  (start)  empty  "loading"`,
    );
  });

  test("an adapter that throws is reported by name", async () => {
    const base = counterOptions(false);
    const events = await message(() =>
      assertMatchesModel({
        ...base,
        events: {
          ...base.events,
          increment: () => {
            throw new Error("boom");
          },
        },
      }),
    );
    expect(events).toMatch(
      /^events\.increment failed after \d+ events \(seed 107806\): Error: boom/,
    );

    const start = await message(() =>
      assertMatchesModel({
        ...base,
        start: () => {
          throw new Error("no start");
        },
      }),
    );
    expect(start).toBe("start() failed after 0 events (seed 107806): Error: no start");

    const read = await message(() =>
      assertMatchesModel({
        ...base,
        state: () => {
          throw "bad read";
        },
      }),
    );
    expect(read).toMatch(/^state\(app\) failed after 0 events \(seed 107806\): bad read/);
  });

  test("a model handler that throws is a model failure", async () => {
    const go = event("go")();
    const a = state("a")();
    const b = state("b")();
    const model = () =>
      Actor({
        inputs: [go],
        states: [a, b],
        initial: a,
        setup: (m) => {
          m.on(a, {
            event: go,
            to: [b],
            handler: () => {
              throw new TypeError("bad handler");
            },
          });
        },
      });
    const msg = await message(() =>
      assertMatchesModel({
        model,
        start: () => ({}),
        events: { go: () => {} },
        state: () => "a" as const,
      }),
    );
    expect(msg).toMatch(
      /^The model on go in a failed after 1 events \(seed 107806\): TypeError: bad handler/,
    );
  });

  test("an edge only reachable with an unlisted payload is reported", async () => {
    const put = event("put")<{ n: number }>();
    const empty = state("empty")();
    const some = state("some")();
    const model = () =>
      Actor({
        inputs: [put],
        states: [empty, some],
        initial: empty,
        setup: (m) => {
          m.on(empty, {
            event: put,
            to: [empty, some],
            handler: (e) => ({ state: e.payload.n > 0 ? some : empty }),
          });
        },
      });
    const received: unknown[] = [];
    const run = (samples: number[]) =>
      assertMatchesModel({
        model,
        start: () => ({ n: 0 }),
        events: {
          put: (app, e) => {
            received.push(e.payload);
            if (app.n === 0) app.n = e.payload.n;
          },
        },
        state: (app) => (app.n > 0 ? "some" : "empty"),
        payloads: { put: samples.map((n) => ({ n })) },
      });
    expect(await message(() => run([0]))).toBe(
      "The app matched the model on 100 walks (seed 107806), but no walk took these model edges:\n  empty --put--> some\nAdd payloads that lead there, or remove the edge from the model.",
    );
    await expect(run([0, 5])).resolves.toBeUndefined();
    expect(received).toContainEqual({ n: 5 });
  });

  test("up-front errors reject before any walk", async () => {
    const base = counterOptions(false);
    expect(
      await message(() =>
        assertMatchesModel({
          ...base,
          // @ts-expect-error -- reset is missing
          events: { increment: base.events.increment, decrement: base.events.decrement },
        }),
      ),
    ).toBe(
      'assertMatchesModel: events has no entry for "reset". Add one for every model input: decrement, increment, reset.',
    );
    expect(
      await message(() =>
        assertMatchesModel({
          ...base,
          // @ts-expect-error -- rest is not a model input
          events: { ...base.events, rest: () => {} },
        }),
      ),
    ).toBe(
      "assertMatchesModel: events.rest is not a model input. Model inputs: decrement, increment, reset.",
    );
    const lone = state("lone")();
    const none = () => Actor({ inputs: [], states: [lone], initial: lone, setup: () => {} });
    expect(
      await message(() =>
        assertMatchesModel({
          model: none,
          start: () => ({}),
          events: {},
          state: () => "lone" as const,
        }),
      ),
    ).toBe("assertMatchesModel: the model has no input events to walk.");
  });
});

describe("assertMatchesModel with an async app", () => {
  function saveModel() {
    const save = event("save")();
    const saveFinished = event("saveFinished")();
    const cancel = event("cancel")();
    const idle = state("idle")();
    const saving = state("saving")();
    const saved = state("saved")();
    return Actor({
      inputs: [save, saveFinished, cancel],
      states: [idle, saving, saved],
      initial: idle,
      setup: (m) => {
        m.on(idle, { event: save, to: [saving], handler: () => ({ state: saving }) });
        m.on(saving, { event: saveFinished, to: [saved], handler: () => ({ state: saved }) });
        m.on(saving, { event: cancel, to: [idle], handler: () => ({ state: idle }) });
        m.on(saved, { event: save, to: [saving], handler: () => ({ state: saving }) });
      },
    });
  }

  function saveApp(buggy: boolean) {
    const app = {
      status: "idle" as "idle" | "saving" | "saved",
      pending: undefined as undefined | (() => Promise<void>),
    };
    return {
      app,
      save: () => {
        if (app.status === "saving") return;
        app.status = "saving";
        app.pending = async () => {
          await Promise.resolve();
          app.status = "saved";
        };
      },
      finish: async () => {
        if (app.status !== "saving") return;
        const pending = app.pending;
        await pending?.();
      },
      cancel: () => {
        if (app.status !== "saving") return;
        if (buggy) return;
        app.status = "idle";
        app.pending = undefined;
      },
    };
  }

  const run = (buggy: boolean) =>
    assertMatchesModel({
      model: saveModel,
      start: async () => saveApp(buggy),
      events: {
        save: (a) => a.save(),
        saveFinished: (a) => a.finish(),
        cancel: (a) => a.cancel(),
      },
      state: async (a) => a.app.status,
    });

  test("a correct async app resolves", async () => {
    await expect(run(false)).resolves.toBeUndefined();
  });

  test("a cancel that is ignored while saving fails", async () => {
    const msg = await message(() => run(true));
    const rows = msg.split("\n").filter((line) => /^ {2}\d+ /.test(line));
    expect(rows.at(-2)).toMatch(/ save /);
    expect(rows.at(-1)).toMatch(/ cancel .*<- differs$/);
  });
});

describe("assertMatchesModel edge cases", () => {
  test("an empty payload list is rejected up front", async () => {
    const put = event("put")<{ n: number }>();
    const a = state("a")();
    const model = () =>
      Actor({
        inputs: [put],
        states: [a],
        initial: a,
        setup: (m) => {
          m.on(a, { event: put, to: [a], handler: () => ({ state: a }) });
        },
      });
    const seen: unknown[] = [];
    const msg = await message(() =>
      assertMatchesModel({
        model,
        start: () => ({}),
        events: {
          put: (_app, e) => {
            seen.push(e);
          },
        },
        state: () => "a" as const,
        payloads: { put: [] },
      }),
    );
    expect(seen).toEqual([]);
    expect(msg).toMatch(/^assertMatchesModel: payloads\.put/);
  });

  test("an app that is not repeatable is reported", async () => {
    let reads = 0;
    const go = event("go")();
    const a = state("a")();
    const b = state("b")();
    const model = () =>
      Actor({
        inputs: [go],
        states: [a, b],
        initial: a,
        setup: (m) => {
          m.on(a, { event: go, to: [b], handler: () => ({ state: b }) });
          m.on(b, { event: go, to: [a], handler: () => ({ state: a }) });
        },
      });
    const msg = await message(() =>
      assertMatchesModel({
        model,
        start: () => ({ s: "a" as "a" | "b" }),
        events: {
          go: (x) => {
            x.s = x.s === "a" ? "b" : "a";
          },
        },
        state: (x) => {
          reads += 1;
          return reads === 7 ? (x.s === "a" ? "b" : "a") : x.s;
        },
      }),
    );
    expect(msg).toBe(
      "assertMatchesModel: the failing walk passed when run again; the app is not repeatable.",
    );
  });

  test("a mismatch on an unhandled event with a payload prints both notes and the payload", async () => {
    const put = event("put")<{ n: number }>();
    const a = state("a")();
    const b = state("b")();
    const model = () => Actor({ inputs: [put], states: [a, b], initial: a, setup: () => {} });
    const msg = await message(() =>
      assertMatchesModel({
        model,
        start: () => ({ s: "a" as "a" | "b" }),
        events: {
          put: (x) => {
            x.s = "b";
          },
        },
        state: (x) => x.s,
        payloads: { put: [{ n: 1 }] },
      }),
    );
    expect(msg).toContain('put {"n":1}');
    expect(msg).toMatch(/model did not handle it, <- differs$/m);
  });
});

describe("assertMatchesModel edges that need no walk", () => {
  test("internal, region and effect edges are not reported", async () => {
    const go = event("go")();
    const next = event("next")();
    const childGo = event("childGo")();
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const x = state("x")();
    const y = state("y")();
    const child = Actor({
      inputs: [childGo],
      states: [x, y],
      initial: x,
      setup: (m) => {
        m.on(x, { event: childGo, to: [y], handler: () => ({ state: y }) });
      },
    });
    const model = () =>
      Actor({
        inputs: [go],
        internal: [next],
        states: [a, b, c],
        initial: a,
        regions: { child },
        setup: (m) => {
          m.on(a, { event: go, to: [b], handler: () => ({ state: b }) });
          m.on(b, { event: next, to: [c], handler: () => ({ state: c }) });
          m.effect(a, { name: "noop", fn: () => {} });
        },
      });
    await expect(
      assertMatchesModel({
        model,
        start: () => ({ s: "a" as "a" | "b" }),
        events: {
          go: (app) => {
            app.s = "b";
          },
        },
        state: (app) => app.s,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("assertMatchesModel failure tables and cleanup", () => {
  const go = event("go")();
  const a = state("a")();
  const b = state("b")();
  const loop = () =>
    Actor({
      inputs: [go],
      states: [a, b],
      initial: a,
      setup: (m) => {
        m.on(a, { event: go, to: [a], handler: () => ({ state: a }) });
      },
    });

  test("row numbers are right-aligned past nine events", async () => {
    const msg = await message(() =>
      assertMatchesModel({
        model: loop,
        start: () => ({ n: 0 }),
        events: {
          go: (app) => {
            app.n += 1;
          },
        },
        state: (app) => (app.n >= 10 ? "b" : "a"),
      }),
    );
    expect(msg).toContain("\n   0  (start)  a      a\n");
    expect(msg).toContain(" 10  go       a      b    <- differs");
  });

  test("a throwing adapter or state read shows a (threw) row", async () => {
    const adapter = await message(() =>
      assertMatchesModel({
        model: loop,
        start: () => ({}),
        events: {
          go: () => {
            throw new Error("boom");
          },
        },
        state: () => "a" as const,
      }),
    );
    expect(adapter).toBe(
      "events.go failed after 1 events (seed 107806): Error: boom\n  #  event    model  app\n  0  (start)  a      a\n  1  go       a      (threw)",
    );
    const read = await message(() =>
      assertMatchesModel({
        model: loop,
        start: () => ({ n: 0 }),
        events: {
          go: (app) => {
            app.n = 1;
          },
        },
        state: (app) => {
          if (app.n > 0) throw new Error("gone");
          return "a" as const;
        },
      }),
    );
    expect(read).toBe(
      "state(app) failed after 1 events (seed 107806): Error: gone\n  #  event    model  app\n  0  (start)  a      a\n  1  go       a      (threw)",
    );
  });

  test("a state read that is not a string is reported as returned", async () => {
    const msg = await message(() =>
      assertMatchesModel({
        model: loop,
        start: () => ({}),
        events: { go: () => {} },
        // @ts-expect-error -- 5 is not a state name
        state: () => 5,
      }),
    );
    expect(msg).toContain("returned 5, which is not a model state (a, b)");
  });

  test("a model handler that throws shows an error row", async () => {
    const boom = () =>
      Actor({
        inputs: [go],
        states: [a, b],
        initial: a,
        setup: (m) => {
          m.on(a, {
            event: go,
            to: [b],
            handler: () => {
              throw new Error("bad");
            },
          });
        },
      });
    const msg = await message(() =>
      assertMatchesModel({
        model: boom,
        start: () => ({}),
        events: { go: () => {} },
        state: () => "a" as const,
      }),
    );
    expect(msg).toBe(
      "The model on go in a failed after 1 events (seed 107806): Error: bad\n  #  event    model    app\n  0  (start)  a        a\n  1  go       __error  -",
    );
  });

  test("uncovered edges are listed by source, label, then target", async () => {
    const p = event("p")();
    const q = event("q")();
    const x = state("x")();
    const y = state("y")();
    const z = state("z")();
    const model = () =>
      Actor({
        inputs: [p, q],
        states: [x, y, z],
        initial: x,
        setup: (m) => {
          m.on(y, { event: p, to: [x], handler: () => ({ state: x }) });
          m.on(x, { event: q, to: [x, y], handler: () => ({ state: x }) });
          m.on(x, { event: p, to: [x, z, y], handler: () => ({ state: x }) });
        },
      });
    const msg = await message(() =>
      assertMatchesModel({
        model,
        start: () => ({}),
        events: { p: () => {}, q: () => {} },
        state: () => "x" as const,
      }),
    );
    expect(msg.split("\n").slice(1, 5)).toEqual([
      "  x --p--> y",
      "  x --p--> z",
      "  x --q--> y",
      "  y --p--> x",
    ]);
  });

  test("an onAny edge that no walk takes is reported", async () => {
    const stop = event("stop")<{ ok: boolean }>();
    const model = () =>
      Actor({
        inputs: [go, stop],
        states: [a, b],
        initial: a,
        setup: (m) => {
          m.on(a, { event: go, to: [a], handler: () => ({ state: a }) });
          m.onAny({ event: stop, to: [a, b], handler: (e) => ({ state: e.payload.ok ? b : a }) });
        },
      });
    const msg = await message(() =>
      assertMatchesModel({
        model,
        start: () => ({}),
        events: { go: () => {}, stop: () => {} },
        state: () => "a" as const,
        payloads: { stop: [{ ok: false }] },
      }),
    );
    expect(msg).toContain("  * --stop--> b");
  });

  test("every walk's model is disposed", async () => {
    const signals: AbortSignal[] = [];
    const watched = () =>
      Actor({
        inputs: [go],
        states: [a],
        initial: a,
        setup: (m) => {
          m.on(a, { event: go, to: [a], handler: () => ({ state: a }) });
          m.effect(a, {
            name: "watch",
            fn: ({ signal }) => {
              signals.push(signal);
            },
          });
        },
      });
    await assertMatchesModel({
      model: watched,
      start: () => ({}),
      events: { go: () => {} },
      state: () => "a" as const,
    });
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.filter((signal) => !signal.aborted).length).toBeLessThanOrEqual(0);
  });
});
