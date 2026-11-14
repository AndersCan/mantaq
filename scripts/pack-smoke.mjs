#!/usr/bin/env node
/**
 * Pack smoke test: install the packed tarballs of @mantaq/viz and
 * @mantaq/inspect (plus their workspace dependencies) into a directory outside
 * the workspace, next to a real `vite`, and check what a user would run: every
 * @mantaq/viz export, and the mantaqViz plugin page, which must carry a
 * stylesheet.
 *
 * Run it after `vp run ready` (not inside `vp run`: the task runner breaks the
 * nested `vp pack` that `prepack` starts).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = ["utils", "core", "pbt", "traversal", "sugar", "viz", "inspect"];
const work = mkdtempSync(join(tmpdir(), "mantaq-pack-smoke-"));
const tarballs = join(work, "tarballs");
const app = join(work, "app");
mkdirSync(tarballs);
mkdirSync(app);

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function fail(message) {
  console.error(`pack-smoke: FAIL ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (condition) console.log(`pack-smoke: ok   ${message}`);
  else fail(message);
}

try {
  const files = {};
  for (const name of PACKAGES) {
    const out = run(
      "vp",
      ["pm", "pack", "--pack-destination", tarballs],
      join(ROOT, "packages", name),
    );
    const file = out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".tgz"))
      .pop();
    if (file === undefined) throw new Error(`no tarball packed for ${name}`);
    files[name] = file;
  }
  const overrides = Object.fromEntries(
    PACKAGES.filter((name) => name !== "inspect").map((name) => [
      `@mantaq/${name}`,
      `file:${files[name]}`,
    ]),
  );
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "pack-smoke",
      private: true,
      type: "module",
      dependencies: {
        "@mantaq/inspect": `file:${files.inspect}`,
        "@mantaq/sugar": `file:${files.sugar}`,
        astro: "^7.2.0",
        vite: "latest",
      },
      overrides,
    }),
  );
  run("npm", ["install", "--no-audit", "--no-fund"], app);
  copyFileSync(join(ROOT, "packages/inspect/src/fixtures/retry.ts"), join(app, "retry.ts"));

  const installed = JSON.parse(
    readFileSync(join(app, "node_modules/@mantaq/inspect/package.json"), "utf8"),
  );
  check(
    installed.bin?.["mantaq-check-site"] !== undefined,
    "inspect tarball has the mantaq-check-site bin",
  );
  const usage = spawnSync(join(app, "node_modules/.bin/mantaq-check-site"), [], {
    encoding: "utf8",
  });
  check(
    usage.status === 2 && usage.stderr.includes("usage: mantaq-check-site <dir>"),
    "mantaq-check-site with no arguments exits 2 with the usage line (needs no playwright)",
  );
  check(!("./live-embedded" in installed.exports), "inspect tarball has no live-embedded export");

  writeFileSync(
    join(app, "check.mjs"),
    `
import { createServer } from "vite";
import { mantaqViz } from "@mantaq/inspect/vite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const results = {};
for (const id of ["@mantaq/viz", "@mantaq/viz/viewer", "@mantaq/viz/page", "@mantaq/viz/viewer.css", "@mantaq/viz/page.css", "@mantaq/inspect"]) {
  results[id] = existsSync(fileURLToPath(import.meta.resolve(id)));
}
await import("@mantaq/viz/page");
await import("@mantaq/viz/viewer");
await import("@mantaq/inspect");
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  logLevel: "silent",
  server: { port: 0, host: "127.0.0.1" },
  plugins: [mantaqViz({ machines: ["retry.ts"], fuzz: { iterations: 50 } })],
});
await server.listen();
const origin = "http://127.0.0.1:" + server.httpServer.address().port;
const page = await (await fetch(origin + "/__mantaq/")).text();
const entry = page.match(/src="(\\/@fs[^"]+)"/)?.[1];
const entryStatus = (await fetch(origin + entry)).status;
const doc = await (await fetch(origin + "/__mantaq/viz.json")).json();
await server.close();
console.log(JSON.stringify({ results, page, entryStatus, schemaVersion: doc.schemaVersion }));
`,
  );
  const out = JSON.parse(run("node", ["check.mjs"], app).trim().split("\n").pop());
  for (const [id, found] of Object.entries(out.results)) check(found, `${id} resolves to a file`);
  check(
    out.page.includes("<style>") && out.page.includes("viz-header"),
    "plugin page carries a stylesheet",
  );
  check(out.entryStatus === 200, "plugin page serves the live entry");
  check(out.schemaVersion === 17, "plugin serves a v17 document");

  const site = join(app, "site");
  mkdirSync(join(site, "src", "pages"), { recursive: true });
  copyFileSync(join(app, "retry.ts"), join(site, "retry.ts"));
  writeFileSync(
    join(site, "astro.config.mjs"),
    `import { defineConfig } from "astro/config";
import { mantaqViz } from "@mantaq/inspect/astro";
export default defineConfig({ integrations: [mantaqViz({ machines: ["retry.ts"], fuzz: false })] });
`,
  );
  writeFileSync(
    join(site, "src/pages/index.astro"),
    `---
import Machine from "@mantaq/inspect/astro/Machine.astro";
---
<html><body><Machine src="retry.ts" /></body></html>
`,
  );
  writeFileSync(
    join(site, "src/pages/machines.astro"),
    `---
import Machines from "@mantaq/inspect/astro/Machines.astro";
---
<html><body><Machines pages={{ "": ["retry.ts"] }} /></body></html>
`,
  );
  run(join(app, "node_modules/.bin/astro"), ["build", "--root", site], app);
  const html = readFileSync(join(site, "dist/index.html"), "utf8");
  check(html.includes("mantaq-machine"), "astro build renders a Machine");
  check(
    readFileSync(join(site, "dist/machines/index.html"), "utf8").includes("mantaq-machines"),
    "astro build renders Machines",
  );
  check(
    readdirSync(join(site, "dist/_astro")).some((file) => file.endsWith(".js")),
    "astro build emits the viewer script",
  );
} catch (error) {
  fail(String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}
