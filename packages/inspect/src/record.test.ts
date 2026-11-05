import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "./examples.ts";
import { inspectModule } from "./inspect.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");
const SCRATCH = mkdtempSync(join(PACKAGE, ".record-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function testFile(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "a.test.ts"),
    `import { VirtualClock } from "@mantaq/core";
import { expect, test } from "vitest";
import { recordRuns } from ${JSON.stringify(join(HERE, "record.ts"))};
import { createTimedActor } from ${JSON.stringify(join(HERE, "fixtures/timed.ts"))};
const make = recordRuns(createTimedActor);
${body}`,
  );
  return join(dir, "__runs__", "a.test.json");
}

function run(dir: string, env: Record<string, string>): { ok: boolean; output: string } {
  const result = spawnSync(
    join(PACKAGE, "node_modules/.bin/vp"),
    ["test", "run", "--root", dir, "--silent=false"],
    {
      cwd: PACKAGE,
      env: { ...process.env, CI: "", ...env },
      encoding: "utf8",
    },
  );
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

const PASSING = `
test("one", () => {
  const clock = VirtualClock();
  const actor = make(clock);
  actor.send({ type: "start" });
  clock.advance(800);
  expect(actor.state.name).toBe("error");
});
test("fails", () => {
  const actor = make();
  actor.send({ type: "start" });
  expect(actor.state.name).toBe("idle");
});
test("two actors", () => {
  make();
  make().send({ type: "start" });
});
`;

describe("recordRuns", () => {
  test("the fixture records itself into its committed file", () => {
    const committed = readFileSync(join(HERE, "fixtures/__runs__/timed.test.json"), "utf8");
    const result = run(join(HERE, "fixtures"), { CI: "1" });
    expect(result.ok).toBe(true);
    expect(committed).toContain('"times out"');
  });

  test("passing tests are recorded, a failed one is not, a second actor is numbered", () => {
    const dir = join(SCRATCH, "record");
    const file = testFile(dir, PASSING);
    run(dir, {});
    const recorded = JSON.parse(readFileSync(file, "utf8")) as {
      timed: { name: string; end: string }[];
    };
    expect(recorded.timed.map((each) => [each.name, each.end])).toEqual([
      ["one", "error"],
      ["two actors", "idle"],
      ["two actors #2", "waiting"],
    ]);
  });

  test("with CI set a tampered file fails with a clear message", () => {
    const dir = join(SCRATCH, "tamper");
    const file = testFile(dir, PASSING);
    run(dir, {});
    writeFileSync(file, readFileSync(file, "utf8").replace('"one"', '"uno"'));
    const result = run(dir, { CI: "1" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("is out of date");
  });

  test("a non-JSON payload is not recorded and warns", () => {
    const dir = join(SCRATCH, "payload");
    const file = testFile(
      dir,
      `test("loop", () => {
  const actor = make();
  actor.send({ type: "start", payload: 10n } as never);
});`,
    );
    const result = run(dir, {});
    expect(result.output).toContain('"loop" not recorded, payload is not JSON');
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  test("inspect shows the recorded runs on the fixture", async () => {
    const { machines } = await inspectModule(
      join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/timed.ts"),
      { load: (path) => import(path), fuzz: { iterations: 0 } },
    );
    expect(machines[0]?.runs.map((each) => each.name)).toEqual(["times out", "waits"]);
  });
});
