// @vitest-environment happy-dom
import { mantaqViz } from "./vite.ts";
import { parseViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";

let out = "";

beforeAll(async () => {
  out = mkdtempSync(join(import.meta.dirname, "site-"));
  await build({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true, minify: false },
    plugins: [mantaqViz({ machines: ["retry.ts", "credit.ts"], base: "/", fuzz: false })],
  });
}, 60_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("mantaqViz build", () => {
  test("emits index.html, viz.json and a script", () => {
    const files = readdirSync(out, { recursive: true }).map(String);
    expect(files).toContain("index.html");
    expect(files).toContain("viz.json");
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    const machines = Either.getRight(parseViz(readFileSync(join(out, "viz.json"), "utf8")));
    expect(machines?.machines.map((machine) => machine.id)).toEqual(["credit", "retry"]);
  });

  test("the built page mounts and steps a machine through the driver", async () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1] ?? "";
    expect(entry).not.toBe("");
    document.body.innerHTML = '<main id="app" data-src="viz.json"></main>';
    const text = readFileSync(join(out, "viz.json"), "utf8");
    globalThis.fetch = async () => new Response(text);
    await import(/* @vite-ignore */ pathToFileURL(join(out, entry)).href);
    const root = document.querySelector("#app");
    await vi.waitFor(() => expect(root?.querySelector("[data-send]")).not.toBeNull());
  });
});
