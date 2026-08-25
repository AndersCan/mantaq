import { test, describe, expect } from "vite-plus/test";
import { fc, anyName, anyPayload, anySnapshot, runProperty } from "@mantaq/pbt";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import { parseTarget } from "../src/dispatch.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { Subscribers } from "../src/subscribers.ts";
import type { Snapshot } from "../src/actor-internal.ts";

describe("event ref property tests", () => {
  test("create builds payload with id and is() accepts only matching ids", () => {
    const anyPayloadObject = fc.object({
      maxKeys: 4,
      values: [fc.string(), fc.integer(), fc.boolean()],
    });
    runProperty(fc.tuple(anyName, anyPayloadObject, anyName), ([id, payload, otherId]) => {
      const ref = event(id)<Record<string, unknown>>();
      if (id === otherId) return true;
      const created = ref.create({ ...payload });
      if (created.type !== id) return false;
      for (const [key, value] of Object.entries(payload)) {
        if ((created.payload as Record<string, unknown>)[key] !== value) return false;
      }
      if (!ref.is(created)) return false;
      if (ref.is({ type: otherId })) return false;
      if (ref.is(null)) return false;
      if (ref.is(42)) return false;
      return true;
    });
  });

  // Soundness of the per-type symbol brand (#262): the brand must be the only
  // thing `is()` trusts, so only envelopes minted by `create()` pass — and only
  // for their own type. These directed assertions back the mutation gate.
  test("same-type ref accepts its own create() and rejects another type's", () => {
    const a = event("A")<void>();
    const b = event("B")<void>();
    expect(a.is(a.create())).toBe(true);
    expect(b.is(b.create())).toBe(true);
    // A must not accept B's envelope (brand is per-type, not just `type` string)
    expect(a.is(b.create())).toBe(false);
    expect(b.is(a.create())).toBe(false);
  });

  test("two refs of the same type share one cached brand", () => {
    const a1 = event("A")<void>();
    const a2 = event("A")<void>();
    expect(a1.is(a2.create())).toBe(true);
    expect(a2.is(a1.create())).toBe(true);
  });

  test("is() rejects non-objects and untyped hand-built objects", () => {
    const a = event("A")<void>();
    expect(a.is(null)).toBe(false);
    expect(a.is(42)).toBe(false);
    expect(a.is("A")).toBe(false);
    expect(a.is({})).toBe(false);
    // hand-built envelope has no brand, so it must be rejected
    expect(a.is({ type: "A" })).toBe(false);
  });

  test("create() keeps payload semantics for with/without payload", () => {
    const a = event("A")<{ n: number }>();
    expect(a.create()).toEqual({ type: "A" });
    expect(a.create({ n: 1 })).toEqual({ type: "A", payload: { n: 1 } });
    expect(a.is(a.create({ n: 1 }))).toBe(true);
  });

  test("brand is non-enumerable (stays out of the observable shape)", () => {
    const a = event("A")<void>();
    const env = a.create();
    expect(Object.keys(env)).toEqual(["type"]);
    expect(JSON.parse(JSON.stringify(env))).toEqual({ type: "A" });
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
        const snap = buildSnapshot(ref, children, {});
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
      const subs = new Subscribers<unknown>();
      const called: number[] = [];
      const offs: Array<() => void> = [];
      for (let i = 0; i < keep.length; i++) {
        offs.push(subs.addChange(() => called.push(i)));
      }
      for (let i = 0; i < keep.length; i++) {
        if (!keep[i]) offs[i]();
      }
      const snap: Snapshot = { path: ["idle"], context: {}, regions: {} };
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
