import fc from "fast-check";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.WWMMmmww";
const REGION_NAMES = ["a", "a.b", "c", "d"];

const name = (min: number, max: number) =>
  fc
    .array(fc.constantFrom(...NAME_CHARS), { minLength: min, maxLength: max })
    .map((chars) => chars.join("").replace(/^\.+|\.+$/g, "") || "x");

const stateOf = (id: string, region: string | null, initial: boolean, effects: string[]): VizState => ({
  id,
  label: id,
  region,
  initial,
  final: false,
  effects: effects.map((effect, index) => ({ name: effect, sends: index % 2 === 0 ? null : [] })),
  coverage: null,
  tested: null,
  doc: null,
});

const edgeOf = (
  index: number,
  parts: { from: string; to: string | null; event: string; kind: VizEdge["kind"] },
  extra: { fuzz: boolean; analysed: boolean; condition: string },
): VizEdge => ({
  id: `e${index}`,
  from: parts.from,
  event: parts.event,
  to: parts.to,
  kind: parts.kind,
  origin: extra.fuzz ? "fuzz" : "declared",
  emits: [],
  contexts: [],
  explanation: extra.analysed
    ? ({
        status: "analyzed",
        location: { file: "a.ts", line: 1, column: 1 },
        registration: "on",
        branches: [
          { conditions: [extra.condition], target: { kind: "stay" } },
          { conditions: [`!(${extra.condition})`], target: { kind: "stay" } },
        ],
        payloadReads: [],
        contextReads: [],
        contextWrites: [],
        readsActorState: false,
        comparisons: [],
        literals: [],
      } as unknown as VizEdge["explanation"])
    : null,
  doc: null,
  coverage: null,
  tested: null,
});

/** A machine with 1..14 states, up to 3 regions (two deep, some pools), dense parallel edges, loops, long names. */
export const machineArbitrary: fc.Arbitrary<VizMachine> = fc
  .record({
    names: fc.uniqueArray(name(1, 32), { minLength: 1, maxLength: 14 }),
    regionCount: fc.integer({ min: 0, max: 3 }),
    pools: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    placement: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 14, maxLength: 14 }),
    effects: fc.array(fc.array(name(3, 20), { maxLength: 3 }), { minLength: 14, maxLength: 14 }),
    withStart: fc.boolean(),
  })
  .chain((base) => {
    const regions = REGION_NAMES.slice(0, base.regionCount).filter(
      (region, _, all) => !region.includes(".") || all.includes(region.split(".")[0] ?? ""),
    );
    const states = base.names.map((leaf, index) => {
      const slot = base.placement[index] ?? 0;
      const region = slot === 0 ? undefined : regions[(slot - 1) % Math.max(regions.length, 1)];
      const id = region === undefined ? leaf : `${region}.${leaf}`;
      return stateOf(id, region ?? null, false, base.effects[index] ?? []);
    });
    const used = regions.filter((region) => states.some((each) => each.id.startsWith(`${region}.`)));
    const ids = states.map((each) => each.id);
    const hot = fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 1, maxLength: 3 });
    return fc.record({
      pairs: hot,
      picks: fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 0, maxLength: 40 }),
      events: fc.array(name(3, 20), { minLength: 40, maxLength: 40 }),
      flags: fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 }),
      condition: name(3, 32),
      endpoints: fc.array(fc.nat(), { minLength: 80, maxLength: 80 }),
    }).map((more) => {
      const edges: VizEdge[] = more.picks.map((choice, index) => {
        const flag = more.flags[index] ?? 0;
        const a = ids[(more.endpoints[2 * index] ?? 0) % ids.length] ?? "";
        const b = ids[(more.endpoints[2 * index + 1] ?? 0) % ids.length] ?? "";
        const pair = more.pairs[choice % more.pairs.length] ?? [0, 0];
        const hotPair = [ids[pair[0] % ids.length] ?? "", ids[pair[1] % ids.length] ?? ""];
        const [picked = a, to = b] = choice < 40 ? [a, b] : choice < 75 ? hotPair : [a, a];
        const from = flag === 15 ? "*" : picked;
        const unknown = flag === 0;
        const kind: VizEdge["kind"] = flag % 3 === 1 ? "stay" : "transition";
        return edgeOf(
          index,
          { from, to: unknown ? null : to, event: more.events[index] ?? "ev", kind },
          { fuzz: flag % 5 === 2, analysed: flag % 4 === 3, condition: more.condition },
        );
      });
      const initial = base.withStart ? (ids[0] ?? null) : null;
      return {
        id: "gen",
        initial,
        regions: used,
        maps: used.filter((region) => base.pools[REGION_NAMES.indexOf(region)] === true),
        actors: [],
        states: states.map((each) => ({ ...each, initial: each.id === initial })),
        events: [],
        outputs: [],
        partOutputs: {},
        context: null,
        edges,
        fuzz: null,
        runs: [],
      } satisfies VizMachine;
    });
  });
