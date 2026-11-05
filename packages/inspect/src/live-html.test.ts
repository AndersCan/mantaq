// @vitest-environment happy-dom
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

const cli = join(import.meta.dirname, "cli.ts");
const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "mantaq-live-"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function write(name: string, args: string[]) {
  const out = join(scratch, name);
  const result = spawnSync("node", [cli, "--no-fuzz", "--no-open", "--out", out, ...args], {
    encoding: "utf8",
  });
  return { result, out };
}

/** Load the page the way a browser would from disk: no network, scripts run in order. */
function load(html: string): void {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network used");
  }) as typeof fetch;
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.body.replaceChildren(...parsed.body.children);
    for (const script of document.querySelectorAll("script:not([type])")) {
      new Function(script.textContent ?? "")();
    }
  } finally {
    globalThis.fetch = original;
  }
}

const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)?.click();
const current = () => document.querySelector(".explore")?.getAttribute("data-current");

describe("mantaq-inspect --live", () => {
  test("the page drives the real machine offline and reaches error after the timer", () => {
    const { result, out } = write("timed.html", ["--live", fixture("timed.ts")]);
    expect(result.status).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html).not.toMatch(/<script[^>]* src=/);
    load(html);
    expect(document.querySelector("[data-send]")).not.toBeNull();
    click('[data-send="start"]');
    expect(current()).toBe("waiting");
    click("[data-advance-timer]");
    expect(current()).toBe("error");
  });

  test("a file with only an instance stays a static walk and warns", () => {
    const { result, out } = write("instance.html", ["--live", fixture("instance.ts")]);
    expect(result.stderr).toMatch(/warning:/);
    load(readFileSync(out, "utf8"));
    expect(document.querySelector("[data-send]")).toBeNull();
    expect(document.querySelector(".explore")).not.toBeNull();
  });

  test("--live with --json is an error", () => {
    const { result } = write("x.json", ["--live", "--json", fixture("timed.ts")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--live and --json cannot be combined");
  });
});
