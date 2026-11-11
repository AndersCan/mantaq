#!/usr/bin/env node
/**
 *   mantaq-check-site <dir> [--base <path>] [--overview <path>] [--links <file> ... --site <url>]
 *
 * Serves a built Astro site and checks, in headless Chromium, that every
 * machine draws, every live machine handles an event and every overview box
 * opens a built page that shows its machine. With --links, every markdown
 * link to a run under --site must open a viewer that has that run. Exit 0 ok, 1 problems, 2 cannot run.
 */
import { Either } from "@mantaq/utils";
import { parseArgs } from "node:util";
import { checkSite } from "./check-site.ts";

const USAGE =
  "usage: mantaq-check-site <dir> [--base <path>] [--overview <path>] [--links <file> ... --site <url>]";

const OPTIONS = {
  base: { type: "string" },
  overview: { type: "string" },
  links: { type: "string", multiple: true },
  site: { type: "string" },
} as const;

async function main(): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch {
    console.error(USAGE);
    return 2;
  }
  const [dir] = parsed.positionals;
  if (dir === undefined || parsed.positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const result = await checkSite(dir, parsed.values.base ?? "/", {
    links: parsed.values.links ?? [],
    site: parsed.values.site,
    overview: parsed.values.overview,
  });
  if (Either.isLeft(result)) {
    console.error(`mantaq-check-site: ${result[0]}`);
    return 2;
  }
  const { pages, failures } = result[1];
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`mantaq-check-site: ${failure}`);
    }
    return 1;
  }
  console.log(`mantaq-check-site: ${pages} pages ok`);
  return 0;
}

process.exitCode = await main();
