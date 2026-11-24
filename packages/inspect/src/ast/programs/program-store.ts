import { Either } from "@mantaq/utils";
import ts from "typescript";

/** Builds one program when the store has none for a file. */
type BuildProgram = (setup: ts.CreateProgramOptions) => ts.Program;

interface StoredProgram {
  optionsKey: string;
  program: ts.Program;
}

/**
 * The TypeScript programs of one build or dev server, one per machine file,
 * and the files they parsed, shared by every program with the same compiler
 * options. A parsed file is reused only while its text is the same.
 */
export interface ProgramStore {
  programs: Map<string, StoredProgram>;
  parsedFiles: Map<string, Map<string, ts.SourceFile>>;
  build: BuildProgram;
}

export interface ProgramStoreOptions {
  build?: BuildProgram;
}

export interface ProgramRoot {
  file: string;
  compilerOptions: ts.CompilerOptions;
}

function buildProgram(setup: ts.CreateProgramOptions): ts.Program {
  return ts.createProgram(setup);
}

export function createProgramStore(options: ProgramStoreOptions = {}): ProgramStore {
  return { programs: new Map(), parsedFiles: new Map(), build: options.build ?? buildProgram };
}

function sharingHost(
  compilerOptions: ts.CompilerOptions,
  parsed: Map<string, ts.SourceFile>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(compilerOptions);
  function getSourceFile(
    ...request: Parameters<ts.CompilerHost["getSourceFile"]>
  ): ts.SourceFile | undefined {
    const [fileName, language] = request;
    const text = Either.from(() => host.readFile(fileName));
    const key = `${fileName}\0${JSON.stringify(language)}`;
    const known = parsed.get(key);
    if (known !== undefined && known.text === Either.getRight(text)) return known;
    const read = Either.getRight(text);
    const sourceFile =
      read === undefined
        ? host.getSourceFile(...request)
        : ts.createSourceFile(fileName, read, language);
    if (sourceFile !== undefined) parsed.set(key, sourceFile);
    return sourceFile;
  }
  return { ...host, getSourceFile };
}

/** The program of `root.file`, built once and reused while its compiler options stay the same. */
export function programFor(store: ProgramStore, root: ProgramRoot): ts.Program {
  const optionsKey = JSON.stringify(root.compilerOptions);
  const stored = store.programs.get(root.file);
  if (stored?.optionsKey === optionsKey) return stored.program;
  const parsed = store.parsedFiles.get(optionsKey) ?? new Map<string, ts.SourceFile>();
  store.parsedFiles.set(optionsKey, parsed);
  const program = store.build({
    rootNames: [root.file],
    options: root.compilerOptions,
    host: sharingHost(root.compilerOptions, parsed),
  });
  store.programs.set(root.file, { optionsKey, program });
  return program;
}

export interface MachineFile {
  file: string;
}

/** Whether the store holds a program for the machine file. */
export function hasProgram(store: ProgramStore, options: MachineFile): boolean {
  return store.programs.has(options.file);
}

export interface SavedFile {
  path: string;
}

/** Drops each program that read the file a save changed. */
export function forgetFile(store: ProgramStore, options: SavedFile): void {
  for (const [file, stored] of store.programs) {
    if (stored.program.getSourceFile(options.path) !== undefined) store.programs.delete(file);
  }
}

/** Drops every program, for a save that adds or removes files and so can change what an import finds. */
export function forgetPrograms(store: ProgramStore): void {
  store.programs.clear();
}
