#!/usr/bin/env node
/**
 * Usage: mantaq-codemod <tsconfig.json>... [--dry-run]
 *
 * Rewrites every source file of each project in place. Files belonging to
 * several projects are migrated once. Run `vp fmt` and `vp check` afterwards:
 * the type checker is the oracle, and unresolved sites fail there on purpose.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { migrate } from "./migrate.ts";

function project(configPath: string): ts.ParsedCommandLine {
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const seen = new Set<string>();
let changed = 0;
for (const config of args.filter((arg) => !arg.startsWith("--"))) {
  const parsed = project(resolve(config));
  const paths = parsed.fileNames.filter(
    (path) => !path.includes("/node_modules/") && !seen.has(path),
  );
  for (const path of paths) seen.add(path);
  const files = new Map(paths.map((path) => [path, readFileSync(path, "utf8")]));
  for (const [path, text] of migrate({ files, options: parsed.options })) {
    changed++;
    console.log(`${dryRun ? "would migrate" : "migrated"} ${path}`);
    if (!dryRun) writeFileSync(path, text);
  }
}
console.log(`${changed} file(s) ${dryRun ? "to migrate" : "migrated"}`);
