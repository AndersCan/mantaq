#!/usr/bin/env node
/**
 * mantaq-inspect: draw the machines a file exports.
 *
 *   mantaq-inspect <file.ts>... [--out FILE] [--json] [--no-fuzz] [--iterations N] [--config FILE]
 *                  [--mode MODE] [--no-open] [--check]
 *
 * Finds every exported actor or actor factory from the file's types, reads
 * handler explanations and sample payloads from the source, fuzzes each
 * machine that runs on a VirtualClock, and writes one self-contained HTML page
 * (default `mantaq-viz.html`) that opens without a server. `--json` writes the
 * viz document instead. `--config` loads the files with that Vite config (env,
 * aliases, plugins) and `--mode` picks its mode. `--check` exits 1 if any warning was printed or
 * fuzzing found a handler error (each printed as `error:`). Seed: MANTAQ_SEED (default from @mantaq/pbt).
 */
import { serializeViz } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
import { vizDocument } from "./inspect.ts";
import type { FuzzSettings } from "./inspect.ts";
import { inspectFile } from "./load.ts";
import type { LoadOptions } from "./load.ts";
import { htmlPage } from "./page.ts";
import { SEED_ENV, parseSeed } from "@mantaq/pbt";
import { Either } from "@mantaq/utils";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE =
  "usage: mantaq-inspect <file.ts>... [--out FILE] [--json] [--no-fuzz] [--iterations N] [--config FILE] [--mode MODE] [--no-open] [--check]\n";

interface Options {
  files: string[];
  out: string;
  json: boolean;
  fuzz: false | FuzzSettings;
  open: boolean;
  check: boolean;
  load: LoadOptions;
}

function loadOptions(config: string | undefined, mode: string | undefined): LoadOptions {
  return {
    ...(config === undefined ? {} : { config: resolve(config) }),
    ...(mode === undefined ? {} : { mode }),
  };
}

function parse(): Either<string, Options> {
  const parsed = Either.from(() =>
    parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string" },
        json: { type: "boolean" },
        iterations: { type: "string" },
        config: { type: "string" },
        mode: { type: "string" },
        "no-fuzz": { type: "boolean" },
        "no-open": { type: "boolean" },
        check: { type: "boolean" },
      },
    }),
  );
  if (Either.isLeft(parsed)) return Either.left(String(parsed[0]));
  const { positionals, values } = parsed[1];
  if (positionals.length === 0) return Either.left("no file given");
  const iterations = Number(values.iterations ?? 2000);
  if (!Number.isInteger(iterations) || iterations < 0) return Either.left("bad --iterations");
  const seed = parseSeed(process.env[SEED_ENV]);
  if (Either.isLeft(seed)) return Either.left(seed[0].message);
  const json = values.json === true;
  const fuzz: false | FuzzSettings =
    values["no-fuzz"] === true ? false : { seed: seed[1], iterations };
  return Either.right({
    files: positionals.map((file) => resolve(file)),
    out: resolve(values.out ?? (json ? "mantaq-viz.json" : "mantaq-viz.html")),
    json,
    fuzz,
    check: values.check === true,
    load: loadOptions(values.config, values.mode),
    open: values["no-open"] !== true && !json && process.stdout.isTTY === true,
  });
}

function openInBrowser(path: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, [path], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

function checkFails(results: { warnings: string[] }[], machines: VizMachine[]): boolean {
  const errors = machines.flatMap((machine) =>
    (machine.fuzz?.errors ?? []).map(
      (error) => `${machine.id}: ${error.from} -${error.event}-> ${error.message}`,
    ),
  );
  for (const error of errors) process.stderr.write(`error: ${error}\n`);
  return errors.length > 0 || results.some((result) => result.warnings.length > 0);
}

async function main(): Promise<void> {
  const options = parse();
  if (Either.isLeft(options)) {
    process.stderr.write(`${options[0]}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const { files, out, json, fuzz, open, check, load } = options[1];
  const results = [];
  for (const file of files) results.push(await inspectFile(file, { fuzz }, load));
  for (const warning of results.flatMap((result) => result.warnings)) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  const failed = results.some((result) => result.failed);
  if (failed) process.exitCode = 1;
  const machines = results.flatMap((result) => result.machines);
  if (check && checkFails(results, machines)) process.exitCode = 1;
  if (machines.length === 0) {
    if (!failed) process.stderr.write("no machines found\n");
    process.exitCode = 1;
    return;
  }
  const document = vizDocument(machines);
  const title = `${files.map((file) => basename(file)).join(", ")} · mantaq viz`;
  writeFileSync(out, json ? serializeViz(document) : await htmlPage(document, title));
  process.stdout.write(`wrote ${out} (${machines.map((machine) => machine.id).join(", ")})\n`);
  if (open) openInBrowser(out);
}

void main();
