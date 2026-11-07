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
const retryAgain = "../fixtures/retry-again.ts";
const empty = "../fixtures/no-machines.ts";
const linked = "../fixtures/linked.ts";

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

function overviewPage(pages: Record<string, string[]>): string {
  return `---\nimport Machines from "@mantaq/inspect/astro/Machines.astro";\n---\n<html><body>\n<Machines pages={${JSON.stringify(pages)}} />\n</body></html>\n`;
}

function makeSite(sources: string[]): string {
  const root = mkdtempSync(join(import.meta.dirname, "astro-site-"));
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  writeFileSync(join(root, "src", "pages", "index.astro"), page(sources));
  return root;
}

beforeAll(async () => {
  site = makeSite([retry, orphan]);
  writeFileSync(
    join(site, "src", "pages", "machines.astro"),
    overviewPage({ "": [linked], other: [retry, orphan] }),
  );
  await buildSite(site, [retry, orphan, linked]);
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
    expect(findings[0]?.dataset["count"]).toBe("2");
    expect(findings[1]?.dataset["count"]).toBe("2");
    expect(findings[1]?.textContent).toContain("2 design findings, marked with ! on the diagram");
    expect(findings[1]?.querySelector("ul")).toBeNull();
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

  test("Machines draws linked machines and links boxes to their pages", () => {
    const html = readFileSync(join(site, "dist", "machines", "index.html"), "utf8").replace(
      /<link[^>]*>/g,
      "",
    );
    document.documentElement.innerHTML = html;
    expect(document.querySelector<HTMLElement>(".mantaq-machines")?.dataset["links"]).toBe("1");
    const link = document.querySelectorAll('.link[data-from="sender"][data-to="receiver"]');
    expect(link).toHaveLength(1);
    expect(link[0]?.textContent).toContain("handedOver");
    expect(document.querySelector('a.box[data-machine="sender"]')?.getAttribute("href")).toMatch(
      /\?machine=sender$/,
    );
    expect(document.querySelector('a.box[data-machine="retry"]')?.getAttribute("href")).toContain(
      "/other/",
    );
    expect(document.querySelector("figcaption")?.textContent).toContain(
      "Click a machine to open its page.",
    );
  });

  test("a Machines page listing a file not in machines fails the build", async () => {
    const root = makeSite([retry]);
    writeFileSync(join(root, "src", "pages", "machines.astro"), overviewPage({ "": [linked] }));
    try {
      await expect(buildSite(root, [retry])).rejects.toThrow(
        /not in the machines given to mantaqViz/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  test("a machine on no page fails the build", async () => {
    const root = makeSite([retry]);
    writeFileSync(join(root, "src", "pages", "machines.astro"), overviewPage({ "": [retry] }));
    try {
      await expect(buildSite(root, [retry, linked])).rejects.toThrow(/is on no page/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

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

  test("the same machine id in two files fails the build naming both", async () => {
    const root = makeSite([retry, retryAgain]);
    try {
      await expect(buildSite(root, [retry, retryAgain])).rejects.toThrow(
        /comes from both .*retry\.ts and .*retry-again\.ts/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  test("a file with no exported machines fails the build", async () => {
    const root = makeSite([empty]);
    try {
      await expect(buildSite(root, [empty])).rejects.toThrow(/no exported actor or actor factory/);
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
