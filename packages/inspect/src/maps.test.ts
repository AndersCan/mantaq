import { VirtualClock } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createPhotoQueue } from "./fixtures/photo-queue.ts";
import { createPhotoQueueDeadEnd } from "./fixtures/photo-queue-dead-end.ts";
import { actorMapsOf } from "./maps.ts";
import { inspect } from "./inspect.ts";
import { toViz, toVizMachine } from "./structure.ts";
import { validateViz } from "@mantaq/viz";
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
  test("map states have no coverage after fuzzing and fuzzing still stops on the root", () => {
    const { machine, warnings } = inspect({ id: "photoQueue", create: () => createPhotoQueue() });
    const inChild = machine.states.filter((each) => each.region === "photos");
    expect(inChild.map((each) => each.coverage)).toEqual([null, null]);
    expect(
      machine.edges.filter((each) => each.from.startsWith("photos.")).map((e) => e.coverage),
    ).toEqual([null]);
    expect(warnings.filter((each) => each.includes("actor map"))).toEqual([]);
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
