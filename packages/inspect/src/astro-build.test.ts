// @vitest-environment happy-dom
import { mantaqViz } from "./astro.ts";
import { parseViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { build } from "astro";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";

process.env["ASTRO_TELEMETRY_DISABLED"] = "1";

let site = "";
const retry = "../fixtures/retry.ts";
const orphan = "../fixtures/orphan.ts";

function page(sources: string[]): string {
  const tags = sources.map((src) => `<Machine src="${src}" />`).join("\n");
  return `---\nimport Machine from "@mantaq/inspect/astro/Machine.astro";\n---\n<html><body>\n${tags}\n</body></html>\n`;
}

async function buildSite(root: string, machines: string[]) {
  await build({
    root,
    logLevel: "silent",
    integrations: [mantaqViz({ machines, fuzz: false })],
  });
}

function built(): string {
  // happy-dom cannot load stylesheets
  return readFileSync(join(site, "dist", "index.html"), "utf8").replace(/<link[^>]*>/g, "");
}

function makeSite(sources: string[]): string {
  const root = mkdtempSync(join(import.meta.dirname, "astro-site-"));
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  writeFileSync(join(root, "src", "pages", "index.astro"), page(sources));
  return root;
}

beforeAll(async () => {
  site = makeSite([retry, orphan]);
  await buildSite(site, [retry, orphan]);
}, 120_000);

afterAll(() => {
  rmSync(site, { recursive: true, force: true });
});

describe("mantaqViz for Astro", () => {
  test("renders findings and a viz document per Machine", () => {
    document.documentElement.innerHTML = built();
    const roots = [...document.querySelectorAll<HTMLElement>(".mantaq-machine")];
    expect(roots).toHaveLength(2);
    for (const root of roots) {
      expect(Either.isRight(parseViz(root.dataset["mantaqViz"] ?? ""))).toBe(true);
    }
    const findings = [...document.querySelectorAll<HTMLElement>(".mantaq-findings")];
    expect(findings).toHaveLength(2);
    expect(findings[0]?.dataset["count"]).toBe("0");
    expect(findings[1]?.dataset["count"]).toBe("1");
    expect(findings[1]?.textContent).toContain(
      "state orphan is declared but no path leads to it from the initial state",
    );
  });

  test("the built script drives the machine live", async () => {
    document.documentElement.innerHTML = built();
    const dist = join(site, "dist", "_astro");
    const entry = readdirSync(dist).find((file) => file.endsWith(".js")) ?? "";
    expect(entry).not.toBe("");
    await import(/* @vite-ignore */ pathToFileURL(join(dist, entry)).href);
    const root = document.querySelectorAll<HTMLElement>(".mantaq-machine")[0];
    await vi.waitFor(() => expect(root?.querySelector("[data-send]")).not.toBeNull());
    const before = root?.querySelector<HTMLElement>(".explore")?.dataset["current"];
    root?.querySelector<HTMLElement>("[data-send]")?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector<HTMLElement>(".explore")?.dataset["current"]).not.toBe(before),
    );
  });

  test("a Machine whose src is not in machines fails the build", async () => {
    const root = makeSite([retry, orphan]);
    try {
      await expect(buildSite(root, [retry])).rejects.toThrow(
        /not in the machines given to mantaqViz/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  test("a missing machine file fails the integration hook", async () => {
    const root = makeSite([retry]);
    try {
      await expect(buildSite(root, ["nope.ts"])).rejects.toThrow(/machine file not found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
