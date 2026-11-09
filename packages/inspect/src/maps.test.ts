import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { createActorMap } from "@mantaq/sugar";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createPhotoQueue } from "./fixtures/photo-queue.ts";
import { createPhotoQueueDeadEnd } from "./fixtures/photo-queue-dead-end.ts";
import { actorMapsOf } from "./maps.ts";
import { inspect } from "./inspect.ts";
import { toViz, toVizMachine } from "./structure.ts";
import { machineFindings, validateViz } from "@mantaq/viz";
import { coverageGoal, withTestCoverage } from "./fuzz/coverage.ts";
import { normalizeRun } from "./runs.ts";
import { execute } from "./fuzz/run.ts";
import { Either } from "@mantaq/utils";
import type { FuzzTarget } from "./fuzz/run.ts";

const target: FuzzTarget = {
  id: "photoQueue",
  create: () => {
    const clock = VirtualClock();
    const made = createPhotoQueue({ clock });
    return { actor: made.actor, clock, made };
  },
};

const add = (photoId: string) =>
  ({ kind: "event", event: "photoAdded", payload: { photoId } }) as const;
const confirm = (key: string) =>
  ({
    kind: "event",
    event: "uploadConfirmed",
    payload: null,
    actor: { map: "photos", key },
  }) as const;

describe("actorMapsOf", () => {
  test("finds maps next to the actor, sorted, and ignores the rest", () => {
    const made = createPhotoQueue();
    const found = actorMapsOf({ ...made, zeta: made.photos, other: 3 });
    expect(Object.keys(found.maps)).toEqual(
      ["other".length ? "photos" : "", "zeta"].filter(Boolean),
    );
    expect(found.old).toEqual([]);
  });

  test("an old map without get is reported", () => {
    const old = { keys: () => [], spawn: () => {}, snapshot: () => undefined, send: () => {} };
    expect(actorMapsOf({ actor: 1, jobs: old })).toEqual({ maps: {}, old: ["jobs"] });
  });

  test("nothing for a bare actor or non-object", () => {
    expect(actorMapsOf(undefined)).toEqual({ maps: {}, old: [] });
    expect(actorMapsOf(null)).toEqual({ maps: {}, old: [] });
  });
});

describe("structure", () => {
  const machine = toVizMachine({ id: "q", ...target.create() });

  test("the map is drawn as one child compartment", () => {
    expect(machine.maps).toEqual(["photos"]);
    expect(machine.regions).toEqual(["photos"]);
    expect(machine.states.find((each) => each.id === "photos.sendingPhoto")?.initial).toBe(true);
    expect(machine.states.find((each) => each.id === "photos.photoSent")?.initial).toBe(false);
    expect(
      machine.edges.some(
        (each) =>
          each.from === "photos.sendingPhoto" &&
          each.event === "uploadConfirmed" &&
          each.to === "photos.photoSent",
      ),
    ).toBe(true);
    expect(
      machine.edges.some((each) => each.kind === "initial" && each.to?.startsWith("photos.")),
    ).toBe(false);
    expect(machine.events.map((each) => each.id)).toContain("uploadConfirmed");
  });

  test("the probe child is removed again", () => {
    const made = createPhotoQueue();
    toVizMachine({ id: "q", actor: made.actor, made });
    expect(made.photos.keys()).toEqual([]);
  });

  test("the document validates", () => {
    const doc = toViz([{ id: "q", actor: target.create().actor, made: target.create().made }]);
    expect(Either.isRight(validateViz(JSON.parse(JSON.stringify(doc))))).toBe(true);
  });

  test("a machine without maps has none", () => {
    expect(toVizMachine({ id: "q", actor: createPhotoQueue().actor }).maps).toEqual([]);
  });
});

describe("inspect", () => {
  test("map states and edges get fuzz coverage and child states count toward coverage", () => {
    const { machine, warnings } = inspect({ id: "photoQueue", create: () => createPhotoQueue() });
    const child = (id: string) => machine.states.find((each) => each.id === id);
    expect(child("photos.sendingPhoto")?.coverage?.hits).toBeGreaterThan(0);
    expect(child("photos.photoSent")?.coverage).toEqual({ hits: 0 });
    const edge = machine.edges.find((each) => each.from === "photos.sendingPhoto");
    expect(edge?.coverage).not.toBeNull();
    expect(warnings.filter((each) => each.includes("actor map"))).toEqual([]);
  });

  test("the coverage goal counts child states and edges as still to reach", () => {
    const clear = { kind: "event", event: "queueCleared", payload: null } as const;
    const { machine } = inspect({
      id: "photoQueue",
      fuzz: false,
      create: () => createPhotoQueue(),
    });
    const trace = execute(target, [add("p1"), clear, add("p1")]);
    expect(coverageGoal(machine)(trace)).toBe(false);
  });

  test("a child that throws gives a warning and no compartment", () => {
    const made = createPhotoQueue();
    const broken = {
      ...made.photos,
      spawn: () => {
        throw new Error("boom");
      },
    };
    const { machine, warnings } = inspect({
      id: "q",
      fuzz: false,
      create: () => ({ actor: made.actor, photos: broken }),
    });
    expect(machine.maps).toEqual([]);
    expect(warnings).toContain("actor map photos: could not start a child to draw it: boom");
  });

  test("children that are not actors give a warning", () => {
    const made = createPhotoQueue();
    const fake = { ...made.photos, get: () => ({}) };
    const { machine, warnings } = inspect({
      id: "q",
      fuzz: false,
      create: () => ({ actor: made.actor, photos: fake }),
    });
    expect(machine.maps).toEqual([]);
    expect(warnings).toContain(
      "actor map photos: its children are not mantaq actors, so they are not drawn",
    );
  });

  test("a map without get warns about an older sugar", () => {
    const made = createPhotoQueue();
    const old = {
      keys: made.photos.keys,
      spawn: made.photos.spawn,
      snapshot: made.photos.snapshot,
      send: made.photos.send,
    };
    const { warnings } = inspect({
      id: "q",
      fuzz: false,
      create: () => ({ actor: made.actor, photos: old }) as never,
    });
    expect(warnings).toContain(
      "photos looks like an actor map from an older @mantaq/sugar (no get): update @mantaq/sugar to draw its children",
    );
  });

  test("the dead-end fixture has a child state without a way out", () => {
    const { machine } = inspect({ id: "q", create: () => createPhotoQueueDeadEnd() });
    expect(machine.maps).toEqual(["photos"]);
    const paused = machine.states.find((each) => each.id === "photos.pausedPhoto");
    expect(paused?.final).toBe(false);
    expect(machine.edges.some((each) => each.from === "photos.pausedPhoto")).toBe(false);
  });
});

describe("driver", () => {
  test("a photo added shows as a child", () => {
    const live = createDriver(target).step(add("p1"));
    expect(live.children).toEqual([
      { map: "photos", key: "p1", state: "photos.sendingPhoto", since: 1 },
    ]);
    expect(live.state).toBe("open");
    expect(live.regions).toEqual({});
  });

  test("a step to a child moves it and not the machine", () => {
    const driver = createDriver(target);
    driver.step(add("p1"));
    const live = driver.step(confirm("p1"));
    expect(live.last).toMatchObject({
      from: "photos.sendingPhoto",
      to: "photos.photoSent",
      outcome: "transition",
      actor: { map: "photos", key: "p1" },
    });
    expect(live.state).toBe("open");
    expect(live.children).toEqual([
      { map: "photos", key: "p1", state: "photos.photoSent", since: 1 },
    ]);
  });

  test("an event the child does not handle is ignored", () => {
    const driver = createDriver(target);
    driver.step(add("p1"));
    driver.step(confirm("p1"));
    expect(driver.step(confirm("p1")).last).toMatchObject({
      outcome: "ignored",
      from: "photos.photoSent",
      actor: { map: "photos", key: "p1" },
    });
  });

  test("a removed child is missing, and clearing empties the list", () => {
    const driver = createDriver(target);
    driver.step(add("p1"));
    driver.step(add("p2"));
    expect(driver.step({ kind: "event", event: "queueCleared", payload: null }).children).toEqual(
      [],
    );
    expect(driver.step(confirm("p1")).last).toMatchObject({
      outcome: "missing",
      from: "",
      to: "",
      actor: { map: "photos", key: "p1" },
    });
  });

  test("children come in key order per map and a respawn is a new child", () => {
    const driver = createDriver(target);
    driver.step(add("b"));
    driver.step(add("a"));
    driver.step(confirm("b"));
    const live = driver.step(add("a"));
    expect(live.children.map((each) => [each.key, each.since])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  test("clearing keeps the removed children with the step that removed them", () => {
    const driver = createDriver(target);
    driver.step(add("p1"));
    driver.step(add("p2"));
    driver.step(confirm("p1"));
    const live = driver.step({ kind: "event", event: "queueCleared", payload: null });
    expect(live.removed).toEqual([
      { map: "photos", key: "p1", state: "photos.photoSent", since: 1, until: 4 },
      { map: "photos", key: "p2", state: "photos.sendingPhoto", since: 2, until: 4 },
    ]);
    expect(live.children).toEqual([]);
    const next = driver.step(add("p3"));
    expect(next.removed?.map((each) => each.key)).toEqual(["p1", "p2"]);
    driver.step({ kind: "event", event: "queueCleared", payload: null });
    expect(next.removed).toHaveLength(2);
    expect(live.removed).toHaveLength(2);
  });

  test("a key holding the id separator is not reported removed", () => {
    const driver = createDriver(target);
    driver.step(add("a\u0000b"));
    driver.step(add("c"));
    driver.step(add("d"));
    const live = driver.step(confirm("a\u0000b"));
    expect(live.children.map((each) => each.key)).toEqual(["a\u0000b", "c", "d"]);
    expect(live.removed).toEqual([]);
  });

  test("a respawn under a live key removes the old child", () => {
    const respawn: FuzzTarget = {
      id: "respawn",
      create: () => {
        const clock = VirtualClock();
        const made = createPhotoQueue({ clock });
        const spawn = made.photos.spawn.bind(made.photos);
        made.photos.ensure = (key) => spawn(key);
        return { actor: made.actor, clock, made };
      },
    };
    const driver = createDriver(respawn);
    driver.step(add("a"));
    const live = driver.step(add("a"));
    expect(live.removed).toEqual([
      { map: "photos", key: "a", state: "photos.sendingPhoto", since: 1, until: 2 },
    ]);
    expect(live.children.map((each) => [each.key, each.since])).toEqual([["a", 2]]);
  });

  test("a reaped child is removed", () => {
    const reaping: FuzzTarget = {
      id: "reaping",
      create: () => {
        const clock = VirtualClock();
        const made = createPhotoQueue({ clock, autoReap: true });
        return { actor: made.actor, clock, made };
      },
    };
    const driver = createDriver(reaping);
    driver.step(add("p1"));
    const live = driver.step(confirm("p1"));
    expect(live.children).toEqual([]);
    expect(live.removed?.[0]).toMatchObject({ key: "p1", since: 1, until: 2 });
    expect(live.removed?.[0]?.state.endsWith(".photoSent")).toBe(true);
  });

  test("reset forgets removed children", () => {
    const driver = createDriver(target);
    driver.step(add("p1"));
    driver.step({ kind: "event", event: "queueCleared", payload: null });
    expect(driver.reset().removed).toEqual([]);
  });

  test("reset empties the children", () => {
    const driver = createDriver(target);
    driver.step(add("p1"));
    expect(driver.reset().children).toEqual([]);
    expect(driver.step(add("p1")).children[0]?.since).toBe(1);
  });

  test("an unknown map is missing", () => {
    const live = createDriver(target).step({
      kind: "event",
      event: "uploadConfirmed",
      payload: null,
      actor: { map: "nope", key: "x" },
    });
    expect(live.last?.outcome).toBe("missing");
  });
});

describe("driver effects and reset", () => {
  const go = event("go")();
  const added = event("added")();
  const waitingS = state("waitingS")();
  const busyS = state("busyS")();
  const ran: string[] = [];
  const effectTarget: FuzzTarget = {
    id: "effectful",
    create: () => {
      const clock = VirtualClock();
      const jobs = createActorMap(() =>
        Actor({
          clock,
          inputs: [go],
          states: [waitingS, busyS],
          initial: waitingS,
          setup: (m) => {
            m.on(waitingS, { event: go, to: [busyS], handler: () => ({ state: busyS }) });
            m.effect(busyS, {
              name: "work",
              fn: () => {
                ran.push("work");
              },
            });
          },
        }),
      );
      const open = state("open")();
      const actor = Actor({
        clock,
        inputs: [added],
        states: [open],
        initial: open,
        setup: (m) => {
          m.on(open, {
            event: added,
            handler: () => {
              jobs.ensure("j1");
              return {};
            },
          });
        },
      });
      return { actor, clock, made: { actor, jobs } };
    },
  };
  const addStep = { kind: "event", event: "added", payload: null } as const;
  const goStep = {
    kind: "event",
    event: "go",
    payload: null,
    actor: { map: "jobs", key: "j1" },
  } as const;

  test("held: a map child's effect is held and listed in waiting", () => {
    ran.length = 0;
    const driver = createDriver(effectTarget);
    driver.step(addStep);
    const live = driver.step(goStep);
    expect(live.waiting).toEqual(["work"]);
    expect(ran).toEqual([]);
  });

  test("real: a map child's effect runs", () => {
    ran.length = 0;
    const driver = createDriver(effectTarget, { effectMode: "real" });
    driver.step(addStep);
    expect(driver.step(goStep).waiting).toEqual([]);
    expect(ran).toEqual(["work"]);
  });
});

function capturedQueue(seen: Array<ReturnType<typeof createPhotoQueue>>): FuzzTarget {
  return {
    id: "photoQueue",
    create: () => {
      const clock = VirtualClock();
      const made = createPhotoQueue({ clock });
      seen.push(made);
      return { actor: made.actor, clock, made };
    },
  };
}

describe("child disposal", () => {
  test("reset disposes the old session's children", () => {
    const seen: Array<ReturnType<typeof createPhotoQueue>> = [];
    const driver = createDriver(capturedQueue(seen));
    driver.step(add("p1"));
    const old = seen[seen.length - 1];
    expect(old?.photos.keys()).toEqual(["p1"]);
    driver.reset();
    expect(old?.photos.keys()).toEqual([]);
  });

  test("a replay disposes its children", () => {
    const seen: Array<ReturnType<typeof createPhotoQueue>> = [];
    const steps = [add("p1"), confirm("p1")];
    const result = normalizeRun(capturedQueue(seen), { name: "t", end: "open", steps });
    expect(result).toEqual(Either.right(steps));
    expect(seen[0]?.photos.keys()).toEqual([]);
  });
});

describe("test coverage", () => {
  test("map states and edges get a tested field", () => {
    const { machine } = inspect({ id: "photoQueue", create: () => createPhotoQueue() });
    const covered = withTestCoverage(target, machine, [[add("p1"), confirm("p1")]]);
    const tested = (id: string) => covered.states.find((each) => each.id === id)?.tested;
    expect(tested("photos.sendingPhoto")).toEqual({ hits: 1 });
    expect(tested("photos.photoSent")).toEqual({ hits: 1 });
    const edge = covered.edges.find((each) => each.from === "photos.sendingPhoto");
    expect(edge?.tested).toEqual({ hits: 1 });
    expect(tested("open")).not.toBeNull();
  });
});

describe("normalizeRun with maps", () => {
  test("a ref to an unknown map is refused", () => {
    const result = normalizeRun(target, {
      name: "t",
      end: "open",
      steps: [{ ...confirm("x"), actor: { map: "nope", key: "x" } }],
    });
    expect(result).toEqual(Either.left('unknown actor map "nope"'));
  });
});

const uploadConfirmedEvent = event("uploadConfirmed")();
const photoAddedEvent = event("photoAdded")<{ photoId: string }>();
const clearedEvent = event("queueCleared")();
const sendingS = state("sendingPhoto")();
const sentS = state("photoSent")().final();
const openS = state("open")();

/** A photo queue with a custom root handler for photoAdded and an optional throwing child. */
function inlineQueue(options: {
  onAdded: (photos: ReturnType<typeof createActorMap>, id: string) => void;
  childThrows?: boolean;
  /** Changes the map the factory returns, after the root has closed over the real one. */
  expose?: (photos: ReturnType<typeof createActorMap>) => ReturnType<typeof createActorMap>;
  /** Keys spawned before the first step. */
  before?: string;
}): FuzzTarget {
  return {
    id: "inline",
    create: () => {
      const clock = VirtualClock();
      const photos = createActorMap(() =>
        Actor({
          clock,
          inputs: [uploadConfirmedEvent],
          states: [sendingS, sentS],
          initial: sendingS,
          setup: (m) => {
            m.on(sendingS, {
              event: uploadConfirmedEvent,
              to: [sentS],
              handler: () => {
                if (options.childThrows === true) throw new Error("boom");
                return { state: sentS };
              },
            });
          },
        }),
      );
      const actor = Actor({
        clock,
        inputs: [photoAddedEvent, clearedEvent],
        states: [openS],
        initial: openS,
        setup: (m) => {
          m.on(openS, {
            event: photoAddedEvent,
            handler: (added) => {
              options.onAdded(photos, added.payload.photoId);
              return {};
            },
          });
          m.on(openS, {
            event: clearedEvent,
            handler: () => {
              for (const key of photos.keys()) photos.kill(key);
              return {};
            },
          });
        },
      });
      if (options.before !== undefined) photos.spawn(options.before);
      return {
        actor,
        clock,
        made: { actor, photos: (options.expose ?? ((each) => each))(photos) },
      };
    },
  };
}

describe("execute records map children", () => {
  test("child states and edges are visited and observed at the step that moved them", () => {
    const trace = execute(target, [add("p1"), confirm("p1")]);
    expect(trace.visited).toContain("photos.sendingPhoto");
    expect(trace.visited).toContain("photos.photoSent");
    expect(trace.features).toContain("state:photos.photoSent");
    expect(trace.features).toContain("edge:photos.sendingPhoto>uploadConfirmed>photos.photoSent");
    const seen = trace.observations.find((each) => each.from === "photos.sendingPhoto");
    expect(seen?.step).toBe(1);
  });

  test("children record when they started and when they were gone", () => {
    const trace = execute(target, [
      add("p1"),
      add("p2"),
      { kind: "event", event: "queueCleared", payload: null },
    ]);
    expect(trace.children).toEqual([
      { map: "photos", key: "p1", from: 0, until: 2 },
      { map: "photos", key: "p2", from: 1, until: 2 },
    ]);
  });

  test("ensure on a live key adds no child, spawn on a live key replaces it", () => {
    expect(execute(target, [add("p1"), add("p1")]).children).toEqual([
      { map: "photos", key: "p1", from: 0, until: null },
    ]);
    const respawn = inlineQueue({ onAdded: (photos, id) => photos.spawn(id) });
    expect(execute(respawn, [add("p1"), add("p1")]).children).toEqual([
      { map: "photos", key: "p1", from: 0, until: 1 },
      { map: "photos", key: "p1", from: 1, until: null },
    ]);
  });

  test("a child that moves inside the handler that started it is observed", () => {
    const quick = inlineQueue({
      onAdded: (photos, id) => {
        photos.ensure(id);
        photos.send(id, uploadConfirmedEvent.create());
      },
    });
    const trace = execute(quick, [add("p1")]);
    const seen = trace.observations.find((each) => each.from === "photos.sendingPhoto");
    expect(seen).toMatchObject({ to: "photos.photoSent", step: 0 });
    expect(trace.features).toContain("edge:photos.sendingPhoto>uploadConfirmed>photos.photoSent");
  });

  test("a child started with spawn and moved in the same handler is observed", () => {
    const quick = inlineQueue({
      onAdded: (photos, id) => {
        photos.spawn(id);
        photos.send(id, uploadConfirmedEvent.create());
      },
    });
    expect(execute(quick, [add("p1")]).features).toContain(
      "edge:photos.sendingPhoto>uploadConfirmed>photos.photoSent",
    );
  });

  test("a child handler that throws becomes a run error and a finding", () => {
    const throwing = inlineQueue({
      onAdded: (photos, id) => photos.ensure(id),
      childThrows: true,
    });
    const trace = execute(throwing, [add("p1"), confirm("p1")]);
    expect(trace.errors).toEqual([
      { from: "photos.sendingPhoto", event: "uploadConfirmed", message: "Error: boom", step: 1 },
    ]);
    const { machine } = inspect({
      id: "inline",
      create: () => throwing.create().made as ReturnType<typeof createPhotoQueue>,
      payloads: { photoAdded: [{ photoId: "p1" }] },
      tests: [{ name: "t", steps: [add("p1"), confirm("p1")] }],
    });
    const found = machineFindings(machine).filter((each) => each.kind === "handlerError");
    expect(found.map((each) => each.state)).toContain("photos.sendingPhoto");
  });

  test("a child that was there before the first step starts at -1", () => {
    const early = inlineQueue({ onAdded: () => {}, before: "pre" });
    expect(execute(early, [add("p1")]).children).toEqual([
      { map: "photos", key: "pre", from: -1, until: null },
    ]);
  });

  test("a child removed earlier keeps the step it was gone after", () => {
    const clear = { kind: "event", event: "queueCleared", payload: null } as const;
    expect(execute(target, [add("p1"), clear, add("p2")]).children).toEqual([
      { map: "photos", key: "p1", from: 0, until: 1 },
      { map: "photos", key: "p2", from: 2, until: null },
    ]);
  });

  test("a map that cannot be wrapped is still scanned after each step", () => {
    const frozen = inlineQueue({
      onAdded: (photos, id) => photos.ensure(id),
      expose: (photos) => Object.freeze({ ...photos }),
    });
    const trace = execute(frozen, [add("p1"), confirm("p1")]);
    expect(trace.children).toEqual([{ map: "photos", key: "p1", from: 0, until: null }]);
    expect(trace.visited).toContain("photos.photoSent");
  });

  test("a key whose child is not an actor is skipped", () => {
    const hollow = inlineQueue({
      onAdded: (photos, id) => photos.ensure(id),
      expose: (photos) => ({ ...photos, get: () => undefined }),
    });
    const trace = execute(hollow, [add("p1")]);
    expect(trace.errors).toEqual([]);
    expect(trace.children).toEqual([]);
  });

  test("a start without a payload keeps the child's state but names no child", () => {
    const trace = execute(target, [{ kind: "event", event: "photoAdded", payload: null }]);
    expect(trace.visited).toContain("photos.sendingPhoto");
    expect(trace.children).toEqual([]);
  });
});
