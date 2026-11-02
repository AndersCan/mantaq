import { EXAMPLE_ROOT } from "./examples.ts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");
const CLI = join(EXAMPLE_ROOT, "packages/inspect/src/cli.ts");

function run(...args: string[]) {
  const { status, stderr } = spawnSync(
    process.execPath,
    [CLI, "--json", "--no-fuzz", "--out", "/dev/null", ...args],
    { encoding: "utf8", cwd: FIXTURES },
  );
  return { status, failed: stderr.includes("VITE_X is not set") };
}

test("exits non-zero when one file fails to load, even if others render", () => {
  expect(run("env.ts", "factories.ts")).toEqual({ status: 1, failed: true });
});

test("loads the project env from a relative --config and --mode", () => {
  expect(run("env.ts", "--config", "env.vite.config.ts", "--mode", "fixture")).toEqual({
    status: 0,
    failed: false,
  });
});
