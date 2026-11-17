import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vite-plus/test";
import { checkout } from "./fixtures/checkout.ts";
import { otherActorsOf } from "./fuzz/run.ts";
import { uploadRegions } from "./fixtures/upload-regions.ts";

test("another actor next to the actor is a part, named by its property", () => {
  const actor = checkout.create({ clock: VirtualClock() });
  const other = checkout.create({ clock: VirtualClock() });
  const found = otherActorsOf({ actor, zeta: other, alpha: other }, actor);
  expect(Object.keys(found)).toEqual(["alpha", "zeta"]);
  expect(found["alpha"]).toBe(other);
});

test("the actor itself, a non-actor and a bare value are not parts", () => {
  const actor = checkout.create({ clock: VirtualClock() });
  expect(otherActorsOf({ actor, again: actor, text: "x", fn: () => 1, none: null }, actor)).toEqual(
    {},
  );
  expect(otherActorsOf(actor, actor)).toEqual({});
  expect(otherActorsOf(undefined, actor)).toEqual({});
});

test("a core region is not drawn twice, by identity or by a property named like its path", () => {
  const actor = uploadRegions.create({ clock: VirtualClock() });
  const region = actor.regions["upload"]!;
  const other = checkout.create({ clock: VirtualClock() });
  expect(otherActorsOf({ actor, mine: region }, actor)).toEqual({});
  expect(otherActorsOf({ actor, upload: other }, actor)).toEqual({});
  expect(Object.keys(otherActorsOf({ actor, uploads: other }, actor))).toEqual(["uploads"]);
});
