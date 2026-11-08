/**
 * Check a built Astro site that holds Mantaq machines: serve it, open every
 * page with a machine in headless Chromium and report what is broken, one
 * line per problem naming the page and the machine.
 */
import { Either } from "@mantaq/utils";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";

export type SiteCheck = { pages: number; failures: string[] };
export type SiteCheckOptions = { links?: string[]; site?: string };

type WalkLink = { where: string; text: string; target: URL };
type Viewer = { src: string; ids: string[]; label: string };
type Box = { id: string; href: string };
type Scan = { viewers: Viewer[]; boxes: Box[] };
type Site = { dir: string; base: string; origin: string };
type PageResult = { scan: Scan | undefined; problems: string[] };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

function normaliseBase(base: string): string {
  const trimmed = base.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

function htmlFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      htmlFiles(path, found);
    } else if (entry.name.endsWith(".html")) {
      found.push(path);
    }
  }
  return found;
}

function pageUrl(dir: string, file: string, base: string): string {
  const rel = file
    .slice(dir.length + 1)
    .split(sep)
    .join("/");
  if (rel === "index.html") {
    return base;
  }
  if (rel.endsWith("/index.html")) {
    return `${base}${rel.slice(0, -"index.html".length)}`;
  }
  return `${base}${rel}`;
}

/** The file a path under the base maps to, or undefined when none is built. */
export function fileFor(dir: string, base: string, urlPath: string): string | undefined {
  if (!urlPath.startsWith(base)) {
    return undefined;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.slice(base.length));
  } catch {
    return undefined;
  }
  const wanted = rel === "" || rel.endsWith("/") ? `${rel}index.html` : rel;
  const target = resolve(dir, `.${sep}${wanted}`);
  if (target !== dir && !target.startsWith(dir + sep)) {
    return undefined;
  }
  if (existsSync(target) && statSync(target).isDirectory()) {
    const index = join(target, "index.html");
    return existsSync(index) ? index : undefined;
  }
  return existsSync(target) ? target : undefined;
}

export function serve(dir: string, base: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split(/[?#]/)[0] ?? "/";
    const file = fileFor(dir, base, path);
    if (file === undefined) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

type PwPage = import("playwright").Page;
type PwLocator = import("playwright").Locator;

async function scan(page: PwPage): Promise<Scan> {
  return page.evaluate(() => {
    const viewers = [...document.querySelectorAll<HTMLElement>(".mantaq-machine")].map((root) => {
      const src = root.dataset["mantaqSrc"] ?? "";
      let ids: string[] = [];
      try {
        const doc = JSON.parse(root.dataset["mantaqViz"] ?? "");
        ids = (doc.machines ?? []).map((machine: { id: string }) => machine.id);
      } catch {
        ids = [];
      }
      return { src, ids, label: `${src} (${ids.join(", ")})` };
    });
    const boxes = [...document.querySelectorAll<HTMLAnchorElement>(".mantaq-machines a.box")].map(
      (a) => ({ id: a.dataset["machine"] ?? "", href: a.getAttribute("href") ?? "" }),
    );
    return { viewers, boxes };
  });
}

async function handlesAnEvent(root: PwLocator, page: PwPage): Promise<string | undefined> {
  const explore = root.locator(".explore");
  if ((await explore.count()) === 0) {
    return undefined;
  }
  const before = await explore.first().getAttribute("data-current");
  const sends = await root.locator("[data-send]").count();
  for (let index = 0; index < sends; index += 1) {
    await root.locator("[data-send]").nth(index).click();
    const payload = root.locator("[data-payload-send]");
    if ((await payload.count()) > 0) {
      await payload.first().click();
    }
    await page.waitForTimeout(50);
    const after = await root.locator(".explore").first().getAttribute("data-current");
    const outcome = root.locator("[data-outcome]");
    const outcomeKind =
      (await outcome.count()) > 0 ? await outcome.first().getAttribute("data-outcome") : undefined;
    if (after !== before || (outcomeKind !== undefined && outcomeKind !== "ignored")) {
      return undefined;
    }
  }
  return sends === 0
    ? "is live but offers no event to send"
    : `handled none of the ${sends} events it offers`;
}

async function checkPage(
  browser: import("playwright").Browser,
  site: Site,
  url: string,
): Promise<PageResult> {
  const { base, origin } = site;
  const failures: string[] = [];
  const page = await browser.newPage();
  const errors: string[] = [];
  const ignored = (location: string) => /\/favicon\.(ico|svg)$/.test(location);
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !ignored(message.location().url)) {
      errors.push(`console error: ${message.text()}`);
    }
  });
  const missing: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404 && !ignored(response.url())) {
      missing.push(response.url().slice(origin.length));
    }
  });
  try {
    const response = await page.goto(origin + url);
    if (response === null || response.status() !== 200) {
      failures.push(
        `${url}: answered ${response?.status() ?? "nothing"} (was the site built with base ${base}?)`,
      );
      return { scan: undefined, problems: failures };
    }
    const found = await scan(page);
    const roots = page.locator(".mantaq-machine");
    for (const [index, viewer] of found.viewers.entries()) {
      const root = roots.nth(index);
      try {
        await root.locator("svg").first().waitFor({ timeout: 10_000 });
      } catch {
        failures.push(`${url}: ${viewer.label} draws no diagram`);
        continue;
      }
      if ((await root.locator("[data-live-note]").count()) === 0) {
        continue;
      }
      const problem = await handlesAnEvent(root, page);
      if (problem !== undefined) {
        failures.push(`${url}: ${viewer.label} ${problem}`);
      }
    }
    if (missing[0] !== undefined) {
      failures.push(
        `${url}: answered 404 for ${missing[0]} (was the site built with base ${base}?)`,
      );
    }
    for (const error of errors) {
      failures.push(`${url}: ${error}`);
    }
    return { scan: found, problems: failures };
  } catch (error) {
    failures.push(`${url}: could not check: ${firstLine(error)}`);
    return { scan: undefined, problems: failures };
  } finally {
    await page.close();
  }
}

function checkBoxes(site: Site, url: string, boxes: Box[], opened: Map<string, Scan>): string[] {
  const { dir, base, origin } = site;
  const failures: string[] = [];
  for (const box of boxes) {
    const target = new URL(box.href, origin + url);
    if (!target.pathname.startsWith(base)) {
      failures.push(
        `${url}: overview box ${box.id} links to ${box.href}, outside the site base ${base}`,
      );
    } else if (fileFor(dir, base, target.pathname) === undefined) {
      failures.push(`${url}: overview box ${box.id} links to ${box.href}, which is not built`);
    } else {
      const file = fileFor(dir, base, target.pathname) ?? "";
      const targetUrl = pageUrl(dir, file, base);
      const shown = opened.get(targetUrl)?.viewers.some((viewer) => viewer.ids.includes(box.id));
      if (shown !== true) {
        failures.push(
          `${targetUrl}: the overview box ${box.id} opens this page, but no viewer here holds ${box.id}`,
        );
      }
    }
  }
  return failures;
}

/** The link as a URL when it goes to a run under the site address; the site root may lack its slash. */
function runLink(href: string, site: URL): URL | undefined {
  const url = URL.parse(href);
  if (url === null || !url.searchParams.has("run") || url.origin !== site.origin) {
    return undefined;
  }
  if (`${url.pathname}/` === site.pathname) {
    url.pathname = site.pathname;
  }
  return url.pathname.startsWith(site.pathname) ? url : undefined;
}

/** The markdown links in the files that go to a run under the site address. */
function walkLinks(files: string[], site: URL): Either<string, WalkLink[]> {
  const found: WalkLink[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return Either.left(`cannot read ${file}`);
    }
    for (const [index, line] of text.split("\n").entries()) {
      for (const match of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const url = runLink(match[2] ?? "", site);
        if (url !== undefined) {
          found.push({ where: `${file}:${index + 1}`, text: match[1] ?? "", target: url });
        }
      }
    }
  }
  return Either.right(found);
}

/** The failure for one walk link: what the viewer at its target says, or why none opens. */
async function checkWalkLink(
  browser: import("playwright").Browser,
  site: Site,
  siteUrl: URL,
  link: WalkLink,
): Promise<string | undefined> {
  const { dir, base, origin } = site;
  const shown = link.text.replace(/\s+/g, " ").trim() || link.target.href;
  const name = `${link.where}: walk link "${shown}"`;
  const id = link.target.searchParams.get("machine") ?? "";
  if (id === "") {
    return `${name} has no machine=, so no viewer opens it`;
  }
  const path = base + link.target.pathname.slice(siteUrl.pathname.length);
  if (fileFor(dir, base, path) === undefined) {
    return `${name} goes to ${path}, which is not built`;
  }
  const page = await browser.newPage();
  try {
    await page.goto(origin + path + link.target.search);
    const found = await scan(page);
    const roots = page.locator(".mantaq-machine");
    const held = found.viewers.flatMap((viewer, index) =>
      viewer.ids.includes(id) ? [roots.nth(index)] : [],
    );
    if (held.length === 0) {
      return `${name} opens ${path}, but no viewer there holds ${id}`;
    }
    for (const root of held) {
      await root.locator("svg").first().waitFor({ timeout: 10_000 });
      const notice = root.locator("[data-run-missing]");
      if ((await notice.count()) > 0) {
        return `${name}: ${((await notice.first().textContent()) ?? "").trim()}`;
      }
    }
    return undefined;
  } catch (error) {
    return `${name}: could not check: ${firstLine(error)}`;
  } finally {
    await page.close();
  }
}

async function checkWalkLinks(
  browser: import("playwright").Browser,
  site: Site,
  siteUrl: URL,
  links: WalkLink[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const link of links) {
    const failure = await checkWalkLink(browser, site, siteUrl, link);
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  return failures;
}

/** The site address and the walk links the options ask to check, or why they cannot. */
function linksToCheck(
  options: SiteCheckOptions,
): Either<string, { siteUrl: URL; links: WalkLink[] }> {
  const files = options.links ?? [];
  const none = new URL("http://unused.invalid/");
  if (files.length === 0) {
    return Either.right({ siteUrl: none, links: [] });
  }
  if (options.site === undefined) {
    return Either.left(
      "--links needs --site, the address the site is published at (e.g. https://you.github.io/repo/)",
    );
  }
  const parsed = URL.parse(options.site);
  if (parsed === null || !/^https?:$/.test(parsed.protocol)) {
    return Either.left(`--site must be an absolute http(s) address, got "${options.site}"`);
  }
  parsed.pathname = parsed.pathname.replace(/\/*$/, "/");
  const read = walkLinks(files, parsed);
  if (Either.isLeft(read)) {
    return read;
  }
  return Either.right({ siteUrl: parsed, links: read[1] });
}

export async function checkSite(
  dirArg: string,
  baseArg: string,
  options: SiteCheckOptions = {},
): Promise<Either<string, SiteCheck>> {
  const dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return Either.left(`${dir} is not a directory`);
  }
  const wanted = linksToCheck(options);
  if (Either.isLeft(wanted)) {
    return wanted;
  }
  const { siteUrl, links } = wanted[1];
  const base = normaliseBase(baseArg);
  const pages = htmlFiles(dir)
    .filter((file) => readFileSync(file, "utf8").includes("mantaq-machine"))
    .map((file) => pageUrl(dir, file, base))
    .sort();
  if (pages.length === 0) {
    return Either.right({ pages: 0, failures: [`no page in ${dir} holds a mantaq machine`] });
  }
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return Either.left(
      "needs the playwright package: npm i -D playwright && npx playwright install chromium",
    );
  }
  let browser: import("playwright").Browser;
  try {
    browser = await playwright.chromium.launch({
      executablePath: process.env["CHROMIUM_PATH"] || undefined,
    });
  } catch (error) {
    return Either.left(
      `could not start Chromium (${firstLine(error)}). Run npx playwright install chromium, or set CHROMIUM_PATH.`,
    );
  }
  const { server, origin } = await serve(dir, base);
  const site = { dir, base, origin };
  const failures: string[] = [];
  try {
    const opened = new Map<string, Scan>();
    for (const url of pages) {
      const result = await checkPage(browser, site, url);
      failures.push(...result.problems);
      if (result.scan !== undefined) {
        opened.set(url, result.scan);
      }
    }
    for (const [url, found] of opened) {
      failures.push(...checkBoxes(site, url, found.boxes, opened));
    }
    failures.push(...(await checkWalkLinks(browser, site, siteUrl, links)));
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
  return Either.right({ pages: pages.length, failures });
}
