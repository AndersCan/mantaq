import { test, describe } from "vite-plus/test";
import { fc, anyName, anyPayload, anySnapshot, runProperty } from "@mantaq/pbt";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import { parseTarget } from "../src/dispatch.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { Subscribers } from "../src/subscribers.ts";
import type { Snapshot } from "../src/actor-internal.ts";

describe("event ref property tests", () => {
  test("create builds payload with id and is() accepts only matching ids", () => {
    const anyPayloadObject = fc
      .object({ maxKeys: 4, values: [fc.string(), fc.integer(), fc.boolean()] })
      .filter((o) => !("id" in o));
    runProperty(fc.tuple(anyName, anyPayloadObject, anyName), ([id, payload, otherId]) => {
      const ref = event(id)<Record<string, unknown>>();
      if (id === otherId) return true;
      const created = ref.create({ ...payload });
      if (created.id !== id) return false;
      for (const [key, value] of Object.entries(payload)) {
        if (created[key] !== value) return false;
      }
      if (!ref.is(created)) return false;
      if (ref.is({ id: otherId })) return false;
      if (ref.is(null)) return false;
      if (ref.is(42)) return false;
      return true;
    });
  });
});

describe("state ref property tests", () => {
  test("create returns { state, payload } and final copies name and regions", () => {
    runProperty(
      fc.tuple(anyName, anyPayload, fc.array(anyName, { minLength: 1, maxLength: 3 })),
      ([name, payload, regionNames]) => {
        const regions = Object.fromEntries(
          regionNames.map((regionName) => [
            regionName,
            { initial: "x", states: { x: state("x")() } },
          ]),
        );
        const ref = state(name)<unknown>().regions(regions);
        const created = ref.create(payload);
        if (created.state !== ref) return false;
        if (created.payload !== payload) return false;

        const final = ref.final();
        if (!final.isFinal) return false;
        if (final.name !== name) return false;
        if (final._regions !== regions) return false;
        return true;
      },
    );
  });
});

describe("parseTarget property tests", () => {
  test("resolves bare refs, wrapped refs, and absence", () => {
    runProperty(fc.tuple(anyName, anyPayload), ([name, payload]) => {
      const ref = state(name)<unknown>();
      const bare = parseTarget({ state: ref, payload });
      if (!bare || bare.state !== ref) return false;
      if (bare.payload !== payload) return false;

      const wrapped = parseTarget({ state: { state: ref, payload }, payload });
      if (!wrapped || wrapped.state !== ref) return false;
      if (wrapped.payload !== payload) return false;

      if (parseTarget({}) !== undefined) return false;
      return true;
    });
  });
});

describe("buildSnapshot property tests", () => {
  test("builds path and preserves region snapshots", () => {
    runProperty(
      fc.tuple(anyName, fc.boolean(), fc.array(anySnapshot, { minLength: 1, maxLength: 4 })),
      ([name, isFinal, childSnaps]) => {
        const regions: Record<string, Snapshot> = {};
        const children: Record<string, { snapshot(): Snapshot }> = {};
        for (let i = 0; i < childSnaps.length; i++) {
          const regionName = `region${i}`;
          regions[regionName] = childSnaps[i];
          children[regionName] = { snapshot: () => childSnaps[i] };
        }
        const ref = isFinal ? state(name)().final() : state(name)();
        const snap = buildSnapshot(ref, children);
        if (snap.path[0] !== name) return false;
        for (const [key, value] of Object.entries(regions)) {
          if (snap.regions[key] !== value) return false;
        }
        if (snap.done !== (isFinal ? true : undefined)) return false;
        return true;
      },
    );
  });
});

describe("Subscribers property tests", () => {
  test("emit reaches exactly the still-subscribed callbacks", () => {
    runProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (keep) => {
      const subs = new Subscribers();
      const called: number[] = [];
      const offs: Array<() => void> = [];
      for (let i = 0; i < keep.length; i++) {
        offs.push(subs.addChange(() => called.push(i)));
      }
      for (let i = 0; i < keep.length; i++) {
        if (!keep[i]) offs[i]();
      }
      const snap: Snapshot = { path: ["idle"], regions: {} };
      subs.emitChange(snap);
      const expected = keep
        .map((k, i) => (k ? i : -1))
        .filter((i) => i >= 0)
        .join(",");
      if (called.join(",") !== expected) return false;
      return true;
    });
  });
});
