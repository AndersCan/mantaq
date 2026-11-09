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
let wiredSite = "";
const retry = "../fixtures/retry.ts";
const clean = "../fixtures/clean.ts";
const orphan = "../fixtures/orphan.ts";
const retryAgain = "../fixtures/retry-again.ts";
const empty = "../fixtures/no-machines.ts";
const linked = "../fixtures/linked.ts";
const wiredSender = "../fixtures/wired/sender.ts";
const wiredReceiver = "../fixtures/wired/receiver.ts";
const wiredSketch = "../fixtures/wired/sketch.ts";
const wiredQuiet = "../fixtures/wired/quiet.ts";
const deadEnd = "../fixtures/dead-end.ts";
const instance = "../fixtures/instance.ts";
const badExpectations = "../fixtures/bad-expectations.ts";
const unhandled = "../fixtures/unhandled.ts";
const vagueNames = "../fixtures/vague-names.ts";

function page(sources: string[]): string {
  const tags = sources.map((src) => `<Machine src="${src}" />`).join("\n");
  return `---\nimport Machine from "@mantaq/inspect/astro/Machine.astro";\n---\n<html><body>\n${tags}\n</body></html>\n`;
}

async function buildSite(
  root: string,
  machines: string[],
  options: Partial<Parameters<typeof mantaqViz>[0]> = {},
) {
  await build({
    root,
    logLevel: "silent",
    integrations: [mantaqViz({ machines, fuzz: false, ...options })],
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
  wiredSite = makeSite([wiredSender]);
  writeFileSync(
    join(wiredSite, "src", "pages", "machines.astro"),
    overviewPage({ "": [wiredSender, wiredReceiver, wiredSketch, wiredQuiet] }),
  );
  await buildSite(wiredSite, [wiredSender, wiredReceiver, wiredSketch, wiredQuiet]);
}, 120_000);

afterAll(() => {
  rmSync(site, { recursive: true, force: true });
  rmSync(wiredSite, { recursive: true, force: true });
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
    expect(findings[0]?.textContent?.trim()).toBe("No design findings. Fuzzing is off.");
    expect(findings[1]?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "1 design finding in orphan: orphan can never be reached.",
    );
    expect(findings[1]?.querySelector("ul")).toBeNull();
  });

  test("the banner for a machine with only a naming note says no findings", async () => {
    const root = makeSite([vagueNames]);
    try {
      await buildSite(root, [vagueNames]);
      document.documentElement.innerHTML = readFileSync(join(root, "dist", "index.html"), "utf8");
      const banner = document.querySelector<HTMLElement>(".mantaq-findings");
      expect(banner?.dataset["count"]).toBe("0");
      expect(banner?.textContent?.trim()).toBe("No design findings. Fuzzing is off.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  test("the banner names an input no state handles", async () => {
    const root = makeSite([unhandled]);
    try {
      await buildSite(root, [unhandled]);
      document.documentElement.innerHTML = readFileSync(join(root, "dist", "index.html"), "utf8");
      const banner = document.querySelector<HTMLElement>(".mantaq-findings");
      expect(banner?.dataset["count"]).toBe("1");
      expect(banner?.textContent?.replace(/\s+/g, " ").trim()).toBe(
        "1 design finding in unhandled: callOff is declared but no state handles it.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

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

  test("Machines draws app-code connections and lists each with its line", () => {
    const html = readFileSync(join(wiredSite, "dist", "machines", "index.html"), "utf8").replace(
      /<link[^>]*>/g,
      "",
    );
    document.documentElement.innerHTML = html;
    const link = document.querySelector('.link[data-from="sender"][data-to="receiver"]');
    expect(link?.textContent).toContain("handedOver → take");
    const items = [...document.querySelectorAll("ul.wires li")].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(
      /^sender → receiver: handedOver → take, in .*wire\.ts:\d+\. receiver ignores take while checking\.$/,
    );
    expect(items.filter((item) => item?.includes("ignores"))).toHaveLength(3);
    expect(
      document.querySelector('a.box[data-machine="sketch"]')?.hasAttribute("data-not-run"),
    ).toBe(true);
    expect(
      document.querySelector('a.box[data-machine="sender"]')?.hasAttribute("data-not-run"),
    ).toBe(false);
    const notRun = [...document.querySelectorAll("ul.not-run li")].map((li) => li.textContent);
    expect(notRun).toHaveLength(1);
    expect(notRun[0]).toMatch(
      /^sketch is not run by the app: no app code calls createSketchActor \(.*wired\/sketch\.ts\)$/,
    );
    expect(document.querySelector("figcaption")?.textContent).toContain(
      "A dashed machine is not run by the app.",
    );
  });

  test("Machine pages carry where each output goes", () => {
    const html = readFileSync(join(wiredSite, "dist", "index.html"), "utf8");
    document.documentElement.innerHTML = html.replace(/<link[^>]*>/g, "");
    const raw = document.querySelector(".mantaq-machine")?.getAttribute("data-mantaq-routes");
    const routes = JSON.parse(raw ?? "{}");
    expect(routes["sender"]["handedOver"][0]).toMatchObject({ to: "receiver", event: "take" });
    expect(routes["sender"]["handedOver"][0].at).toMatch(/wire\.ts:\d+$/);
  });

  test("Machines draws a dashed arrow to no machine for an output nothing listens to", () => {
    const html = readFileSync(join(wiredSite, "dist", "machines", "index.html"), "utf8").replace(
      /<link[^>]*>/g,
      "",
    );
    document.documentElement.innerHTML = html;
    const arrows = [...document.querySelectorAll("g.unheard")];
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.getAttribute("data-from")).toBe("quiet");
    expect(arrows[0]?.getAttribute("data-outputs")).toBe("unheard");
    expect(arrows[0]?.textContent?.trim()).toBe("unheard → nobody");
    expect(document.querySelector("figcaption")?.textContent).toContain(
      "A dashed arrow to no machine is an output no app code listens to.",
    );
    expect(document.querySelectorAll("ul.wires li")).toHaveLength(3);
    expect(document.querySelectorAll("ul.not-run li")).toHaveLength(1);
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

  test("runEffects marks the diagram to run its effects, and is absent by default", async () => {
    for (const run of [true, false]) {
      const root = makeSite([clean]);
      try {
        const tag = run ? `<Machine src="${clean}" runEffects />` : `<Machine src="${clean}" />`;
        const source = page([]).replace("\n\n</body>", `\n${tag}\n</body>`);
        writeFileSync(join(root, "src", "pages", "index.astro"), source);
        await buildSite(root, [clean]);
        const html = readFileSync(join(root, "dist", "index.html"), "utf8");
        document.documentElement.innerHTML = html.replace(/<link[^>]*>/g, "");
        const machine = document.querySelector<HTMLElement>(".mantaq-machine");
        expect(machine?.dataset["mantaqEffects"]).toBe(run ? "run" : undefined);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }, 120_000);

  describe("failOnFindings", () => {
    async function withSite(sources: string[], run: (root: string) => Promise<void>) {
      const root = makeSite(sources);
      try {
        await run(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    test("lists a structural finding", async () => {
      await withSite([orphan], async (root) => {
        await expect(buildSite(root, [orphan], { failOnFindings: true })).rejects.toThrow(
          /failOnFindings: 2 problems stop the build\n.*orphan in .*orphan\.ts:\n  - orphan can never be reached\./,
        );
      });
    }, 120_000);

    test("lists a fuzz finding with the events that lead there", async () => {
      await withSite([deadEnd], async (root) => {
        await expect(
          buildSite(root, [deadEnd], { fuzz: { iterations: 200 }, failOnFindings: true }),
        ).rejects.toThrow(/  - waitingForReply is a dead end\..*\n {4}after: replyRequested/);
      });
    }, 120_000);

    test("builds when every machine is clean and fuzzed", async () => {
      await withSite([clean], async (root) => {
        await buildSite(root, [clean], { fuzz: { iterations: 200 }, failOnFindings: true });
      });
    }, 120_000);

    test("a machine that cannot be fuzzed fails, unless fuzz is off", async () => {
      await withSite([instance], async (root) => {
        await expect(
          buildSite(root, [instance], { fuzz: {}, failOnFindings: true }),
        ).rejects.toThrow(/  - not fuzzed: exported as one actor, not a factory/);
        await buildSite(root, [instance], { fuzz: false, failOnFindings: true });
      });
    }, 120_000);

    test("a malformed expectation fails", async () => {
      await withSite([badExpectations], async (root) => {
        await expect(
          buildSite(root, [badExpectations], { fuzz: { iterations: 200 }, failOnFindings: true }),
        ).rejects.toThrow(/expectations for /);
      });
    }, 120_000);

    test("a recorded run that does not replay fails", async () => {
      const source = join(import.meta.dirname, "fixtures", "clean.ts");
      await withSite([clean], async (root) => {
        mkdirSync(join(root, "m", "__runs__"), { recursive: true });
        writeFileSync(join(root, "m", "clean.ts"), `export * from ${JSON.stringify(source)};\n`);
        writeFileSync(
          join(root, "m", "__runs__", "clean.test.json"),
          JSON.stringify({
            clean: [
              {
                name: "Nils declines",
                end: "waitingForRequest",
                steps: [{ kind: "event", event: "requestArrived", payload: {} }],
              },
            ],
          }),
        );
        await expect(
          buildSite(root, ["m/clean.ts"], { fuzz: { iterations: 200 }, failOnFindings: true }),
        ).rejects.toThrow(
          /failOnFindings: 1 problem stops the build\n.*clean in .*clean\.ts:\n {2}- run "Nils declines" dropped: replays to handlingRequest, the test ended in waitingForRequest\. The page builds the actor with only a VirtualClock/,
        );
      });
    }, 120_000);

    test("astro dev does not fail", async () => {
      const hook = mantaqViz({ machines: [orphan], fuzz: false, failOnFindings: true }).hooks[
        "astro:config:setup"
      ];
      let plugin: { load?: (this: unknown, id: string) => unknown } | undefined;
      const config = { root: pathToFileURL(`${import.meta.dirname}/astro-dev-root/`) };
      await hook?.({
        command: "dev",
        config,
        updateConfig: (update: {
          vite?: {
            plugins?: Array<{ name?: string; load?: (this: unknown, id: string) => unknown }>;
          };
        }) => {
          plugin = update.vite?.plugins?.find((p) => p.name === "mantaq-viz-astro");
          return config;
        },
      } as never);
      const warn = vi.fn();
      const error = vi.fn();
      const source = await plugin?.load?.call({ warn, error }, "\0virtual:mantaq/documents");
      expect(typeof source).toBe("string");
      expect(error).not.toHaveBeenCalled();
    });
  });
});
