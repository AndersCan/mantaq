import { VirtualClock } from "@mantaq/core";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createUploadRegionsActor } from "./fixtures/upload-regions.ts";
import { createNestedRegionsActor } from "./fixtures/nested-regions.ts";
import { fuzz } from "./fuzz/fuzz.ts";
import { execute } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { normalizeRun } from "./runs.ts";
import { toVizMachine } from "./structure.ts";

const target: FuzzTarget = {
  id: "uploadRegions",
  create: () => {
    const clock = VirtualClock();
    return { actor: createUploadRegionsActor({ clock }), clock };
  },
};

const picked = {
  kind: "event",
  event: "photoPicked",
  payload: { fileName: "a.jpg" },
  actor: { region: "upload" },
} as const;

describe("structure", () => {
  test("each region's start state is initial, the machine's initial is the root's", () => {
    const machine = toVizMachine({ id: "x", actor: target.create().actor });
    const initial = machine.states.filter((each) => each.initial).map((each) => each.id);
    expect(initial).toEqual(["network.online", "showingUploadScreen", "upload.waitingForPhoto"]);
    expect(machine.initial).toBe("showingUploadScreen");
    expect(machine.events.find((each) => each.id === "photoUploaded")?.internal).toBe(true);
  });
});

describe("driver", () => {
  test("a step reaches its region", () => {
    const live = createDriver(target).step(picked);
    expect(live.regions).toEqual({
      network: "network.online",
      upload: "upload.sendingPhoto",
    });
    expect(live.state).toBe("showingUploadScreen");
    expect(live.last).toMatchObject({
      from: "upload.waitingForPhoto",
      to: "upload.sendingPhoto",
      outcome: "transition",
      actor: { region: "upload" },
    });
  });

  test("the same event sent to the root is ignored", () => {
    const { actor: _actor, ...root } = picked;
    const live = createDriver(target).step(root);
    expect(live.last?.outcome).toBe("ignored");
    expect(live.regions["upload"]).toBe("upload.waitingForPhoto");
  });

  test("a region that does not exist is missing", () => {
    const live = createDriver(target).step({ ...picked, actor: { region: "nope" } });
    expect(live.last).toMatchObject({
      outcome: "missing",
      from: "",
      to: "",
      actor: { region: "nope" },
    });
  });

  test("an event the region cannot handle now is ignored in that region", () => {
    const live = createDriver(target).step({ ...picked, event: "uploadConfirmed", payload: null });
    expect(live.last).toMatchObject({
      outcome: "ignored",
      from: "upload.waitingForPhoto",
      actor: { region: "upload" },
    });
  });

  test("a region's output moves the root, and its own step comes first", () => {
    const driver = createDriver(target);
    driver.step(picked);
    const live = driver.step({
      kind: "event",
      event: "uploadConfirmed",
      payload: null,
      actor: { region: "upload" },
    });
    expect(live.last).toMatchObject({ from: "upload.sendingPhoto", to: "upload.photoSent" });
    expect(live.after[0]).toMatchObject({
      from: "showingUploadScreen",
      to: "showingUploadedPhoto",
      event: "photoUploaded",
    });
    expect(live.state).toBe("showingUploadedPhoto");
  });

  test("a region still takes events after the root is final", () => {
    const driver = createDriver(target);
    driver.step(picked);
    driver.step({ ...picked, event: "uploadConfirmed", payload: null });
    const live = driver.step({
      kind: "event",
      event: "connectionLost",
      payload: null,
      actor: { region: "network" },
    });
    expect(live.regions["network"]).toBe("network.offline");
  });
});

describe("fuzz", () => {
  test("visits every region state", () => {
    const result = fuzz(target, { seed: DEFAULT_SEED, iterations: 500 });
    const visited = new Set(result.corpus.flatMap((entry) => execute(target, entry.steps).visited));
    expect([...visited].sort()).toEqual([
      "network.offline",
      "network.online",
      "showingUploadScreen",
      "showingUploadedPhoto",
      "upload.photoSent",
      "upload.sendingPhoto",
      "upload.waitingForPhoto",
    ]);
  });
});

describe("journeys", () => {
  const run = (steps: Parameters<typeof normalizeRun>[1]["steps"], end: string) =>
    normalizeRun(target, { name: "r", steps, end });

  test("a region step is kept", () => {
    expect(run([picked], "showingUploadScreen")).toEqual(Either.right([picked]));
  });

  test("an unknown region is refused", () => {
    expect(run([{ ...picked, actor: { region: "x" } }], "showingUploadScreen")).toEqual(
      Either.left('unknown region "x"'),
    );
  });

  test("an unknown event of a region is refused", () => {
    expect(run([{ ...picked, event: "nope" }], "showingUploadScreen")).toEqual(
      Either.left('unknown event "nope" in region upload'),
    );
  });
});

describe("nested regions", () => {
  const ran: string[] = [];
  const nested: FuzzTarget = {
    id: "nested",
    create: () => {
      const clock = VirtualClock();
      return { actor: createNestedRegionsActor({ clock, ran }), clock };
    },
  };
  const toWorker = {
    kind: "event",
    event: "go",
    payload: null,
    actor: { region: "worker" },
  } as const;

  const pingStep = {
    kind: "event",
    event: "ping",
    payload: null,
    actor: { region: "worker.sub" },
  } as const;

  test("machine marks a region's internal event as internal", () => {
    const machine = toVizMachine({ id: "n", actor: nested.create().actor });
    expect(machine.events.find((each) => each.id === "tick")?.internal).toBe(true);
    expect(machine.events.find((each) => each.id === "go")?.internal).toBeFalsy();
  });

  test("a region's internal event is a no-op where its state cannot handle it", () => {
    const live = createDriver(nested).step({ ...toWorker, event: "tick" });
    expect(live.regions["worker"]).toBe("worker.ready");
    expect(live.last?.outcome).not.toBe("transition");
  });

  test("a region's internal event is handled where its state can", () => {
    const driver = createDriver(nested);
    driver.step(toWorker);
    const live = driver.step({ ...toWorker, event: "tick" });
    expect(live.regions["worker"]).toBe("worker.ready");
  });

  test("a throwing region handler is recorded with its region", () => {
    const live = createDriver(nested).step({ ...toWorker, event: "boom" });
    expect(live.last?.error).toContain("worker exploded");
    expect(live.last?.actor).toEqual({ region: "worker" });
  });

  test("the same event name on root and region goes to the region addressed", () => {
    const live = createDriver(nested).step(toWorker);
    expect(live.state).toBe("idle");
    expect(live.last).toMatchObject({
      from: "worker.ready",
      to: "worker.running",
      actor: { region: "worker" },
    });
    const root = createDriver(nested).step({ kind: "event", event: "go", payload: null });
    expect(root.state).toBe("done");
    expect(root.last?.actor).toBeUndefined();
    expect(root.regions["worker"]).toBe("worker.ready");
  });

  test("the step's own entry comes first when the root reacts to the same event name", () => {
    const live = createDriver(nested).step(pingStep);
    expect(live.last).toMatchObject({ actor: { region: "worker.sub" }, event: "ping" });
    expect(live.after.some((each) => each.actor === undefined && each.event === "ping")).toBe(true);
    expect(live.state).toBe("done");
  });

  test("a nested region takes steps by dotted path", () => {
    const live = createDriver(nested).step(pingStep);
    expect(live.regions["worker.sub"]).toBe("worker.sub.b");
    expect(live.last).toMatchObject({
      from: "worker.sub.a",
      to: "worker.sub.b",
      actor: { region: "worker.sub" },
    });
    expect(normalizeRun(nested, { name: "n", steps: [pingStep], end: "done" })).toEqual(
      Either.right([pingStep]),
    );
  });

  test("held effects do not run in regions, real ones do", () => {
    ran.length = 0;
    createDriver(nested, { effectMode: "held" }).step(toWorker);
    expect(ran).toEqual([]);
    createDriver(nested, { effectMode: "real" }).step(toWorker);
    expect(ran).toEqual(["work"]);
  });
});
