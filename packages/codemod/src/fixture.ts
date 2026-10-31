import { join } from "node:path";
import ts from "typescript";
import { migrate } from "./migrate.ts";
import type { Transform } from "./edits.ts";

const OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
};

/** Virtual file next to this package, so `@mantaq/core` resolves from its node_modules. */
const PATH = join(import.meta.dirname, "__virtual__", "machine.ts");

export const HEADER = `import { Actor, event, state } from "@mantaq/core";
const idle = state("idle")();
const busy = state("busy")();
const done = state("done")().final();
const go = event("GO")();
const stop = event("STOP")();
`;

export function machine(setup: string, states = "[idle, busy, done]"): string {
  return `${HEADER}export const actor = Actor({
  inputs: [go, stop],
  states: ${states},
  initial: idle,
  setup: (m) => {
${setup}
  },
});
`;
}

/** Migrated text, or the input when nothing changed. */
export function run(text: string, transforms?: readonly Transform[]): string {
  const changed = migrate({ files: new Map([[PATH, text]]), options: OPTIONS, transforms });
  return changed.get(PATH) ?? text;
}

/** Strip whitespace so assertions ignore formatting. */
export function squash(text: string): string {
  return text.replace(/\s+/g, "");
}
