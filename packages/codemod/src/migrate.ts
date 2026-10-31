import ts from "typescript";
import { applyEdits } from "./edits.ts";
import type { Transform } from "./edits.ts";
import { declareTargets } from "./transforms/declare-targets.ts";
import { eventKey } from "./transforms/event-key.ts";

/** Every migration, oldest first. Append new breaking changes here. */
export const TRANSFORMS: readonly Transform[] = [eventKey, declareTargets];

export interface MigrateInput {
  /** Absolute path -> current text. Only these files are rewritten; imports resolve from disk. */
  files: ReadonlyMap<string, string>;
  options: ts.CompilerOptions;
  transforms?: readonly Transform[];
}

function overlayHost(
  files: ReadonlyMap<string, string>,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const disk = ts.createCompilerHost(options, true);
  return {
    ...disk,
    fileExists: (path) => files.has(path) || disk.fileExists(path),
    readFile: (path) => files.get(path) ?? disk.readFile(path),
    getSourceFile: (path, language, onError) => {
      const text = files.get(path);
      if (text === undefined) return disk.getSourceFile(path, language, onError);
      return ts.createSourceFile(path, text, language, true);
    },
  };
}

function runTransform(
  transform: Transform,
  at: { files: Map<string, string>; options: ts.CompilerOptions },
): void {
  const host = overlayHost(at.files, at.options);
  const program = ts.createProgram({ rootNames: [...at.files.keys()], options: at.options, host });
  const checker = program.getTypeChecker();
  for (const [path, text] of at.files) {
    const file = program.getSourceFile(path);
    const edits = file ? transform.edits(file, checker) : [];
    if (edits.length > 0) at.files.set(path, applyEdits(text, edits));
  }
}

/**
 * Run each transform over all files, rebuilding the program between steps so
 * later transforms see earlier rewrites. Returns only the files that changed.
 */
export function migrate(input: MigrateInput): Map<string, string> {
  const files = new Map(input.files);
  for (const transform of input.transforms ?? TRANSFORMS) {
    runTransform(transform, { files, options: input.options });
  }
  return new Map([...files].filter(([path, text]) => input.files.get(path) !== text));
}
