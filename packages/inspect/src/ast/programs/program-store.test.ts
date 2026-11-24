import { createProgramStore, forgetFile } from "./program-store.ts";
import { describe, expect, test } from "vite-plus/test";
import type { InspectedModule } from "../../inspect.ts";
import { inspectModule } from "../../inspect.ts";
import { join } from "node:path";
import type { ProgramStore } from "./program-store.ts";
import { targetsSource } from "../../vite.ts";
import ts from "typescript";

const FIXTURES = join(import.meta.dirname, "../../fixtures");
const FILES = ["credit.ts", "previewed.ts", "retry.ts"].map((name) => join(FIXTURES, name));
const CORE = join(import.meta.dirname, "../../../../core/src/machine.ts");

function countingStore(built: string[]): ProgramStore {
  return createProgramStore({
    build: (setup) => {
      built.push(...setup.rootNames);
      return ts.createProgram(setup);
    },
  });
}

interface Load {
  programs?: ProgramStore;
}

function documents(options: Load): Promise<InspectedModule[]> {
  return Promise.all(
    FILES.map((file) =>
      inspectModule(file, { ...options, load: (path) => import(path), fuzz: false }),
    ),
  );
}

/** What the dev server does after a save: the targets and previews modules, then each file's document. */
function loadAll(options: Load): Promise<InspectedModule[]> {
  targetsSource(FILES, options);
  return documents(options);
}

describe("program store", () => {
  test("one program per machine file serves targets, previews and the document", async () => {
    const built: string[] = [];
    await loadAll({ programs: countingStore(built) });
    expect(built).toEqual(FILES);
  });

  test("a save rebuilds only the programs that read the saved file", async () => {
    const built: string[] = [];
    const programs = countingStore(built);
    await loadAll({ programs });
    built.length = 0;
    forgetFile(programs, { path: join(FIXTURES, "retry.ts") });
    await loadAll({ programs });
    expect(built).toEqual([join(FIXTURES, "retry.ts")]);
  });

  test("a save of a file every program reads rebuilds each program once", async () => {
    const built: string[] = [];
    const programs = countingStore(built);
    await loadAll({ programs });
    built.length = 0;
    forgetFile(programs, { path: CORE });
    await loadAll({ programs });
    expect(built).toEqual(FILES);
  });

  test("shared programs give the same documents as a program per call", async () => {
    expect(await loadAll({ programs: createProgramStore() })).toEqual(await documents({}));
  });
});
