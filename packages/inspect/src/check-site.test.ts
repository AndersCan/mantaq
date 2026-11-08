import { Either } from "@mantaq/utils";
import { build } from "astro";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mantaqViz } from "./astro.ts";
import { checkSite, fileFor, serve } from "./check-site.ts";

process.env["ASTRO_TELEMETRY_DISABLED"] = "1";

const retry = "../fixtures/retry.ts";
const linked = "../fixtures/linked.ts";
const deaf = "../fixtures/deaf.ts";
const orphan = "../fixtures/orphan.ts";
const stay = "../fixtures/stay.ts";
const timed = "../fixtures/timed.ts";

let good = "";
let broken = "";
let quiet = "";
let empty = "";
let walks = "";
const roots: string[] = [];

function viewerPage(src: string, extra = ""): string {
  return `---\nimport Machine from "@mantaq/inspect/astro/Machine.astro";\n---\n<html><body>\n<Machine src="${src}" />\n${extra}</body></html>\n`;
}

function overviewPage(pages: Record<string, string[]>): string {
  return `---\nimport Machines from "@mantaq/inspect/astro/Machines.astro";\n---\n<html><body>\n<Machines pages={${JSON.stringify(pages)}} />\n</body></html>\n`;
}

async function makeSite(machines: string[], pages: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(import.meta.dirname, "check-site-"));
  roots.push(root);
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  for (const [name, text] of Object.entries(pages)) {
    writeFileSync(join(root, "src", "pages", name), text);
  }
  await build({
    root,
    logLevel: "silent",
    integrations: [mantaqViz({ machines, fuzz: false })],
  });
  return join(root, "dist");
}

beforeAll(async () => {
  empty = mkdtempSync(join(tmpdir(), "check-site-empty-"));
  roots.push(empty);
  good = await makeSite([retry, linked], {
    "index.astro": viewerPage(retry),
    "pair.astro": viewerPage(linked),
    "machines.astro": overviewPage({ "": [retry], pair: [linked] }),
  });
  quiet = await makeSite([stay], {
    "index.astro": viewerPage(
      stay,
      `<link rel="icon" href="/favicon.ico">\n<script is:inline>console.log("hello");console.warn("careful")</script>\n`,
    ),
  });
  broken = await makeSite([retry, linked, deaf, orphan], {
    "index.astro": viewerPage(retry, `<script is:inline>throw new Error("boom")</script>\n`),
    "deaf.astro": viewerPage(deaf),
    "blank.astro": `<html><body><div class="mantaq-machine" data-mantaq-src="blank.ts"></div></body></html>\n`,
    "machines.astro": overviewPage({ "": [retry, orphan], deaf: [deaf], gone: [linked] }),
  });
  walks = await makeSite([timed, retry], {
    "index.astro": viewerPage(timed),
    "other.astro": viewerPage(retry),
  });
}, 240_000);

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("checkSite", () => {
  test("passes a good site", async () => {
    expect(await checkSite(good, "/")).toEqual(Either.right({ pages: 3, failures: [] }));
  }, 120_000);

  test("names every fault on a broken site", async () => {
    const result = await checkSite(broken, "/");
    expect(Either.isRight(result)).toBe(true);
    const failures = Either.isRight(result) ? result[1].failures : [];
    expect([...failures].sort()).toEqual(
      [
        "/: page error: boom",
        "/: the overview box orphan opens this page, but no viewer here holds orphan",
        "/blank/: blank.ts () draws no diagram",
        "/deaf/: ../fixtures/deaf.ts (deaf) handled none of the 1 events it offers",
        "/machines/: overview box receiver links to /gone/?machine=receiver, which is not built",
        "/machines/: overview box sender links to /gone/?machine=sender, which is not built",
      ].sort(),
    );
  }, 120_000);

  test("ignores console logs, warnings and a missing favicon, and counts a staying handler as handled", async () => {
    expect(await checkSite(quiet, "/")).toEqual(Either.right({ pages: 1, failures: [] }));
  }, 120_000);

  test("a wrong base says so", async () => {
    const result = await checkSite(good, "/nope");
    const failures = Either.isRight(result) ? result[1].failures : [];
    expect(
      failures.some((line) =>
        /^\/nope\/: answered 404 for \/_astro\/\S+ \(was the site built with base \/nope\/\?\)$/.test(
          line,
        ),
      ),
    ).toBe(true);
  }, 120_000);
});

describe("checkSite cannot run", () => {
  test("a missing folder", async () => {
    const result = await checkSite("/does/not/exist", "/");
    expect(Either.isLeft(result) ? result[0] : "").toContain("is not a directory");
  });

  test("opens the walk links in a doc and fails on one that opens no walk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "check-site-links-"));
    roots.push(dir);
    const site = "https://example.test/docs";
    const file = join(dir, "walks.md");
    writeFileSync(
      file,
      [
        `[waits](${site}/?machine=timed&run=waits)`,
        `[nope](${site}/?machine=timed&run=nope)`,
        "[elsewhere](https://other.test/?machine=timed&run=nope)",
        `[no machine](${site}/?run=waits)`,
        `[gone](${site}/gone/?machine=timed&run=waits)`,
        `[held](${site}/other/?machine=timed&run=waits)`,
        `[plain](${site}/?machine=timed)`,
        `[bare root](${site}?machine=timed&run=nope)`,
        `[titled](${site}/?machine=timed&run=nope "a title")`,
        `[waits again](${site}/?machine=timed&run=waits)`,
        `[sibling](https://example.test/docsx/?machine=timed&run=nope)`,
      ].join("\n"),
    );
    expect(await checkSite(walks, "/", { links: [file], site })).toEqual(
      Either.right({
        pages: 2,
        failures: [
          `${file}:2: walk link "nope": No run named "nope" in timed. Runs: times out, waits`,
          `${file}:4: walk link "no machine" has no machine=, so no viewer opens it`,
          `${file}:5: walk link "gone" goes to /gone/, which is not built`,
          `${file}:6: walk link "held" opens /other/, but no viewer there holds timed`,
          `${file}:8: walk link "bare root": No run named "nope" in timed. Runs: times out, waits`,
          `${file}:9: walk link "titled": No run named "nope" in timed. Runs: times out, waits`,
        ],
      }),
    );
  }, 120_000);

  test("cannot run without a site, with a bad site or with a missing file", async () => {
    expect(await checkSite(walks, "/", { links: ["x.md"] })).toEqual(
      Either.left(
        "--links needs --site, the address the site is published at (e.g. https://you.github.io/repo/)",
      ),
    );
    expect(await checkSite(walks, "/", { links: ["x.md"], site: "nope" })).toEqual(
      Either.left('--site must be an absolute http(s) address, got "nope"'),
    );
    expect(await checkSite(walks, "/", { links: ["missing.md"], site: "https://a.test/" })).toEqual(
      Either.left("cannot read missing.md"),
    );
  });

  test("a folder without machines", async () => {
    const result = await checkSite(empty, "/");
    expect(result).toEqual(
      Either.right({ pages: 0, failures: [`no page in ${empty} holds a mantaq machine`] }),
    );
  });
});

describe("static server", () => {
  test("refuses a path outside the folder", async () => {
    expect(fileFor(good, "/", "/../package.json")).toBeUndefined();
    expect(fileFor(good, "/", "/%2e%2e/package.json")).toBeUndefined();
    const { server, origin } = await serve(good, "/");
    try {
      const raw = await new Promise<string>((done) => {
        const url = new URL(origin);
        void import("node:net").then(({ connect }) => {
          const socket = connect(Number(url.port), url.hostname, () => {
            socket.write("GET /../package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
          });
          let text = "";
          socket.on("data", (chunk) => (text += chunk));
          socket.on("close", () => done(text));
        });
      });
      expect(raw.startsWith("HTTP/1.1 404")).toBe(true);
    } finally {
      server.close();
    }
  });

  test("serves an index and 404s outside the base", async () => {
    expect(fileFor(good, "/", "/")).toBe(join(good, "index.html"));
    expect(fileFor(good, "/site/", "/other/")).toBeUndefined();
    expect(fileFor(good, "/", "/pair")).toBe(join(good, "pair", "index.html"));
  });
});

describe("mantaq-check-site", () => {
  const cli = join(import.meta.dirname, "check-site-cli.ts");

  test("no arguments is a usage error", () => {
    const run = spawnSync("node", [cli], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toBe(
      "usage: mantaq-check-site <dir> [--base <path>] [--links <file> ... --site <url>]",
    );
  });

  test("an unknown flag is a usage error", () => {
    expect(spawnSync("node", [cli, good, "--wat"], { encoding: "utf8" }).status).toBe(2);
  });

  test("--links and --site reach the check: a bad walk link exits 1, --links alone exits 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-site-cli-links-"));
    roots.push(dir);
    const file = join(dir, "walks.md");
    writeFileSync(file, "[nope](https://example.test/docs/?machine=timed&run=nope)\n");
    const bad = spawnSync(
      "node",
      [cli, walks, "--links", file, "--site", "https://example.test/docs"],
      { encoding: "utf8" },
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(`${file}:1: walk link "nope": No run named "nope"`);
    const alone = spawnSync("node", [cli, walks, "--links", file], { encoding: "utf8" });
    expect(alone.status).toBe(2);
    expect(alone.stderr).toContain("--links needs --site");
  }, 120_000);

  test("a good site exits 0", () => {
    const run = spawnSync("node", [cli, good], { encoding: "utf8" });
    expect(run.stdout.trim()).toBe("mantaq-check-site: 3 pages ok");
    expect(run.status).toBe(0);
  }, 120_000);

  test("prints each problem with the command prefix and exits 1 on a broken site", () => {
    const run = spawnSync("node", [cli, broken], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("mantaq-check-site: /blank/: blank.ts () draws no diagram");
  }, 120_000);
});
