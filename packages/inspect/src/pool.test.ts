import { VirtualClock } from "@mantaq/core";
import { systemOf } from "@mantaq/viz";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createTeamInbox } from "./fixtures/pool.ts";
import { createUploadRegionsActor } from "./fixtures/upload-regions.ts";
import { toViz } from "./structure.ts";

function teamInbox() {
  const clock = VirtualClock();
  const made = createTeamInbox({ clock });
  return { actor: made.actor, clock, made };
}

describe("a pool, as parts that talk", () => {
  const machine = toViz([{ id: "teamInbox", ...teamInbox() }]).machines[0];

  test("records the declared outputs of the worker map", () => {
    expect(machine?.outputs).toEqual(["team.ITEMS_ASSIGNED"]);
    expect(machine?.partOutputs).toEqual({
      workers: ["team.ITEMS_FAILED", "team.ITEMS_FINISHED", "team.ITEMS_RETURNED"],
    });
  });

  test("the inbox and the workers link both ways", () => {
    const system = systemOf(machine!);
    expect(system.parts.map((part) => [part.id, part.kind])).toEqual([
      ["", "root"],
      ["workers", "map"],
    ]);
    const assigned = system.links.find((link) => link.event === "team.ITEMS_ASSIGNED");
    expect(assigned).toMatchObject({
      from: "",
      to: "workers",
      handledIn: ["workers.free", "workers.working"],
    });
    expect(system.links.filter((link) => link.to === "").map((link) => link.event)).toEqual([
      "team.ITEMS_FAILED",
      "team.ITEMS_FINISHED",
      "team.ITEMS_RETURNED",
    ]);
    for (const link of system.links.filter((each) => each.to === "")) {
      expect(link.handledIn).toEqual(["empty", "holding"]);
    }
  });
});

describe("a step on a pool names the part that moved after it", () => {
  test("the driver reports w1 taking the work", () => {
    const driver = createDriver({ id: "teamInbox", create: teamInbox });
    const live = driver.step({
      kind: "event",
      event: "team.ITEM_ARRIVED",
      payload: { item: "a" },
    });
    expect(live.after.map((each) => [each.actor, each.from, each.to])).toEqual([
      [{ map: "workers", key: "w1" }, "workers.free", "workers.working"],
    ]);
  });
});

describe("regions record their outputs too", () => {
  test("the upload region's photoUploaded reaches its parent", () => {
    const machine = toViz([{ id: "photoUpload", actor: createUploadRegionsActor() }]).machines[0];
    expect(machine?.partOutputs).toEqual({ upload: ["photoUploaded"] });
    expect(systemOf(machine!).links).toMatchObject([
      { from: "upload", to: "", event: "photoUploaded" },
    ]);
  });
});
