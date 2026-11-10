import { machineBrief } from "./brief.ts";
import { EXAMPLE_ROOT } from "./examples.ts";
import { inspectFile } from "./load.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type { VizMachine } from "@mantaq/viz";

async function load(name: string): Promise<VizMachine> {
  const file = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures", `${name}.ts`);
  const { machines } = await inspectFile(file, { fuzz: false });
  const machine = machines[0];
  if (machine === undefined) throw new Error(`no machine in ${name}`);
  return machine;
}

describe("machineBrief", () => {
  for (const name of ["documented", "checkout", "retry", "upload-regions"]) {
    test(`${name} brief`, async () => {
      const machine = await load(name);
      const brief = machineBrief(machine);
      await expect(brief).toMatchFileSnapshot(`./__snapshots__/brief/${name}.md`);
      for (const state of machine.states) expect(brief).toContain(`### \`${state.id}\``);
      expect(brief.endsWith("\n")).toBe(true);
      expect(brief.endsWith("\n\n")).toBe(false);
      expect(brief.split("\n").some((line) => line.endsWith(" "))).toBe(false);
    });
  }

  test("a handled event below the limit shows as a stay", async () => {
    expect(machineBrief(await load("retry"))).toContain(
      "- `failed` → stays when `!(current.attempts > 10)`",
    );
  });

  test("edges seen only while fuzzing are left out", async () => {
    const machine = await load("retry");
    const base = machine.edges[0];
    if (base === undefined) throw new Error("no edges");
    const fuzzed: VizMachine = {
      ...machine,
      edges: [
        ...machine.edges,
        {
          ...base,
          id: "fuzz-extra",
          from: "idle",
          event: "reset",
          to: "connected",
          kind: "transition",
          origin: "fuzz",
          explanation: null,
          doc: null,
        },
      ],
    };
    expect(machineBrief(fuzzed)).toBe(machineBrief(machine));
  });

  test("a condition with a backtick goes in a double-backtick span", async () => {
    const machine = await load("retry");
    const edges = machine.edges.map((edge) =>
      edge.explanation?.status === "analyzed" && edge.event === "failed"
        ? {
            ...edge,
            explanation: {
              ...edge.explanation,
              branches: edge.explanation.branches.map((branch) => ({
                ...branch,
                conditions: branch.conditions.length > 0 ? ["a === `x`"] : [],
              })),
            },
          }
        : edge,
    );
    expect(machineBrief({ ...machine, edges })).toContain("when `` a === `x` ``");
  });

  test("hand-built machine: effects, duplicates, outputs, optional fields, region targets", async () => {
    const base = await load("retry");
    const template = base.edges[0];
    const state = base.states[0];
    if (template === undefined || state === undefined) throw new Error("empty fixture");
    const mk = (id: string, region: string | null, initial: boolean, sends: string[] | null[]) => ({
      ...state,
      id,
      region,
      initial,
      final: false,
      doc: null,
      effects: [{ name: "work", sends: sends.length === 0 ? null : (sends as string[]) }],
    });
    const edge = (
      id: string,
      to: string | null,
      branches: VizMachine["edges"][number]["explanation"],
    ) => ({
      ...template,
      id,
      from: "net.up",
      event: "go",
      to,
      kind: "transition" as const,
      origin: "declared" as const,
      emits: [],
      doc: null,
      explanation: branches,
    });
    const analyzed = (branches: Array<{ conditions: string[]; target: unknown }>) =>
      ({
        status: "analyzed",
        location: { file: "x.ts", line: 1, column: 1 },
        registration: "on",
        branches,
        payloadReads: [],
        contextReads: [],
        contextWrites: [],
        readsActorState: false,
        comparisons: [],
        literals: [],
      }) as unknown as VizMachine["edges"][number]["explanation"];
    const machine: VizMachine = {
      ...base,
      id: "synthetic",
      initial: null,
      regions: ["net"],
      maps: [],
      outputs: ["done"],
      events: [
        {
          id: "go",
          internal: false,
          doc: null,
          payload: [
            {
              name: "n",
              type: "number",
              optional: true,
              doc: null,
              input: "number",
              choices: [],
              sample: 0,
            },
          ],
        },
      ],
      states: [
        mk("net.up", "net", true, ["a", "b", "c"]),
        mk("net.down", "net", false, ["a", "b"]),
        mk("net.idle", "net", false, ["a"]),
      ],
      edges: [
        edge("e1", "net.idle", null),
        edge("e2", "net.idle", null),
        edge(
          "e3",
          null,
          analyzed([
            { conditions: ["x"], target: { kind: "state", state: "down" } },
            { conditions: ["y"], target: { kind: "unresolved", text: "pick()" } },
          ]),
        ),
      ],
    };
    const brief = machineBrief(machine);
    expect(brief.match(/- `go` → `net.idle`/g)).toHaveLength(1);
    expect(brief).not.toContain("Starts in");
    expect(brief).toContain("which sends `a`, `b` or `c`.");
    expect(brief).toContain("which sends `a` or `b`.");
    expect(brief).toContain("which sends `a`.");
    expect(brief).toContain("- `go` → `net.down` when `x`");
    expect(brief).toContain("- `go` → decided at run time (`pick()`) when `y`");
    expect(brief).toContain("## Outputs\n\n- `done`");
    expect(brief).toContain("with `n?: number`");
  });
});
