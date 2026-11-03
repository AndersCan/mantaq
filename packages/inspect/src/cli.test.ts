import { EXAMPLE_ROOT } from "./examples.ts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const CLI = join(EXAMPLE_ROOT, "packages/inspect/src/cli.ts");
const fixture = (name: string) => join(EXAMPLE_ROOT, "packages/inspect/src/fixtures", name);

function run(args: string[]) {
  return spawnSync("node", [CLI, "--json", "--no-open", "--out", "/dev/null", ...args], {
    cwd: join(EXAMPLE_ROOT, "packages/inspect"),
    encoding: "utf8",
    env: { ...process.env, MANTAQ_SEED: "1" },
  });
}

describe("--check", () => {
  test("exits 0 for a clean machine", () => {
    expect(run(["--check", "--iterations", "200", fixture("checkout.ts")]).status).toBe(0);
  });

  test("exits 1 and prints error: when a handler throws", () => {
    const result = run(["--check", "--iterations", "200", fixture("throwing.ts")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^error: .*idle -pick->/m);
  });

  test("exits 1 on warnings", () => {
    const result = run(["--check", "--no-fuzz", fixture("state-routing.ts")]);
    expect(result.stderr).toMatch(/warning:/);
    expect(result.status).toBe(1);
  });

  test("without --check the same files exit 0", () => {
    expect(run(["--iterations", "200", fixture("throwing.ts")]).status).toBe(0);
  });
});

describe("--live", () => {
  test("cannot be combined with --json", () => {
    const result = run(["--live", fixture("checkout.ts")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--live and --json cannot be combined");
  });
});
