import { createProgramStore, programFor } from "./programs/program-store.ts";
import type { VizLocation } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { dirname, relative, sep } from "node:path";
import ts from "typescript";
import type { ProgramStore } from "./programs/program-store.ts";

export interface AnalysisSource {
  /** Absolute path of the file that registers the handlers (`m.on` / `m.onAny`). */
  file: string;
  /** Locations are reported relative to this directory. */
  root: string;
  /** tsconfig used to type-check the file. Default: nearest one above `file`. */
  tsconfig?: string;
}

/** One `m.on(state, { event, handler })` or `m.onAny({ event, handler })` call. */
export interface Registration {
  kind: "on" | "onAny";
  /** Resolved state name; null for onAny or when the type has no literal name. */
  state: string | null;
  event: string | null;
  /** Regex source for an event whose type is a template literal (`${N}.ITEM_ARRIVED`); null otherwise. */
  eventPattern: string | null;
  /** JSDoc of the symbol the `event:` expression names. null = none. */
  eventDoc: string | null;
  /** The `event:` expression: an EventRef, whose type carries the payload type. */
  eventRef: ts.Expression;
  handler: ts.Expression | undefined;
  call: ts.CallExpression;
  /** Leading JSDoc of the statement holding the call. null = none. */
  doc: string | null;
}

/** What one source file contributes: its handler registrations and descriptions. */
export interface FileRead {
  registrations: Registration[];
  /** Leading JSDoc by state name, from `const x = state("x")()` declarations. */
  stateDocs: Map<string, string>;
  /** Leading JSDoc by event type, from `const x = event("X")()` declarations. */
  eventDocs: Map<string, string>;
  /** JSDoc above each `m.effect(state, ...)` call by state name, in registration order. */
  effectDocs: Map<string, string[]>;
}

export interface LoadedSource extends FileRead {
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
  root: string;
  /** Other files of the program (not declarations) that register handlers, e.g. a pool built in a library. */
  elsewhere: Array<
    FileRead & {
      file: string;
      /** Imports from the root to a file its `create` bodies run; the farthest value for a file it does not call. */
      depth: number;
    }
  >;
}

/** The module specifiers a file imports or re-exports from. */
function moduleSpecifiers(file: ts.SourceFile): string[] {
  return file.statements.flatMap((statement) => {
    const named = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
    const from = named ? statement.moduleSpecifier : undefined;
    return from !== undefined && ts.isStringLiteral(from) ? [from.text] : [];
  });
}

/** Declaring files of a symbol, aliases (imports, re-exports) followed. */
function declaringFiles(checker: ts.TypeChecker, node: ts.Node): string[] {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return [];
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return (target.declarations ?? []).map((declaration) => declaration.getSourceFile().fileName);
}

/** True when `type` is the `Actor` of `@mantaq/core`. */
function isCoreActor(type: ts.Type): boolean {
  const symbol = type.getSymbol();
  if (symbol?.name !== "Actor") return false;
  return (symbol.declarations ?? []).some((declaration) =>
    /[\\/]core[\\/]/.test(declaration.getSourceFile().fileName),
  );
}

/**
 * Files the root's `create` bodies run: where each called function is declared,
 * and where the object a method such as `syncMachine.create()` is called on is
 * declared. Calls outside a `create` (a title, a name) do not count.
 */
function calledFiles(checker: ts.TypeChecker, root: ts.SourceFile): Set<string> {
  const files = new Set<string>();
  const visit = (node: ts.Node, inCreate: boolean): void => {
    if (inCreate && ts.isCallExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      // Only a helper that returns an actor ranks its file; a label or options object does not.
      const actor = isCoreActor(checker.getTypeAtLocation(node));
      if (declaration !== undefined && actor) files.add(declaration.getSourceFile().fileName);
      const callee = node.expression;
      const receivers =
        actor && ts.isPropertyAccessExpression(callee)
          ? declaringFiles(checker, callee.expression)
          : [];
      for (const file of receivers) files.add(file);
    }
    const creating =
      ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "create";
    ts.forEachChild(node, (child) => visit(child, inCreate || creating));
  };
  visit(root, false);
  return files;
}

/** Import distance from `root` to every file it reaches (the root is 0, a direct import 1). */
function importDepths(
  program: ts.Program,
  context: { root: ts.SourceFile; options: ts.CompilerOptions },
): Map<string, number> {
  const depths = new Map([[context.root.fileName, 0]]);
  let frontier = [context.root];
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const next: ts.SourceFile[] = [];
    for (const file of frontier) {
      for (const specifier of moduleSpecifiers(file)) {
        const resolved = ts.resolveModuleName(
          specifier,
          file.fileName,
          context.options,
          ts.sys,
        ).resolvedModule;
        const target = resolved && program.getSourceFile(resolved.resolvedFileName);
        if (!target || depths.has(target.fileName)) continue;
        depths.set(target.fileName, depth);
        next.push(target);
      }
    }
    frontier = next;
  }
  return depths;
}

/**
 * Prose of the JSDoc block found in the trivia starting at `pos`, or null when
 * there is none. Block tags (`@param`, ...) and everything after them are cut;
 * `{@link x}` reads as `x`.
 */
function docAt(sourceFile: ts.SourceFile, pos: number): string | null {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, pos) ?? [];
  const block = ranges.filter((range) => sourceFile.text.startsWith("/**", range.pos)).at(-1);
  if (block === undefined) return null;
  const lines = sourceFile.text
    .slice(block.pos + 3, block.end - 2)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, "").trim());
  const tag = lines.findIndex((line) => line.startsWith("@"));
  const text = (tag === -1 ? lines : lines.slice(0, tag))
    .join("\n")
    .replace(/\{@link(?:code|plain)?\s+([^}|\s]+)[^}]*\}/g, "$1")
    .trim();
  return text === "" ? null : text;
}

function docOf(node: ts.Node): string | null {
  return docAt(node.getSourceFile(), node.getFullStart());
}

/**
 * Doc of one `m.on(...)` link. The first link of a chain owns the comment above
 * the statement; later links own the comment just before their `.on`.
 */
function callDoc(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee) && ts.isCallExpression(callee.expression)) {
    return docAt(call.getSourceFile(), callee.expression.end);
  }
  let top: ts.Node = call;
  while (ts.isPropertyAccessExpression(top.parent) || ts.isCallExpression(top.parent)) {
    top = top.parent;
  }
  return docOf(ts.isExpressionStatement(top.parent) ? top.parent : call);
}

function collectEffectDoc(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  effectDocs: Map<string, string[]>,
): void {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "effect")
    return;
  const [stateArg] = call.arguments;
  if (stateArg === undefined) return;
  const state = literalProperty(checker, stateArg, "name");
  const doc = callDoc(call);
  if (state === null || doc === null) return;
  effectDocs.set(state, [...(effectDocs.get(state) ?? []), doc]);
}

/** Compiler options of the tsconfig at `configPath`; strict defaults when there is none. */
export function tsconfigOptions(configPath: string | undefined): ts.CompilerOptions {
  if (configPath === undefined) {
    return { strict: true, allowImportingTsExtensions: true, noEmit: true };
  }
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath)).options;
}

function compilerOptions(source: AnalysisSource): ts.CompilerOptions {
  const configPath =
    source.tsconfig ?? ts.findConfigFile(dirname(source.file), (path) => ts.sys.fileExists(path));
  return tsconfigOptions(configPath);
}

/** Literal string type of `expr.<property>` (e.g. a StateRef's `name`), or null. */
export function literalProperty(
  checker: ts.TypeChecker,
  expr: ts.Expression,
  property: string,
): string | null {
  const symbol = checker.getTypeAtLocation(expr).getProperty(property);
  if (symbol === undefined) return null;
  const type = checker.getTypeOfSymbolAtLocation(symbol, expr);
  return type.isStringLiteral() ? type.value : null;
}

function property(literal: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const element of literal.properties) {
    if (!element.name || !ts.isIdentifier(element.name) || element.name.text !== name) continue;
    if (ts.isPropertyAssignment(element)) return element.initializer;
    if (ts.isShorthandPropertyAssignment(element)) return element.name;
    if (ts.isMethodDeclaration(element)) return undefined;
  }
  return undefined;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `^<text>.+<text>$` for an event typed as a template literal; null for any other type. */
function templatePattern(checker: ts.TypeChecker, eventRef: ts.Expression): string | null {
  const symbol = checker.getTypeAtLocation(eventRef).getProperty("type");
  if (symbol === undefined) return null;
  const type = checker.getTypeOfSymbolAtLocation(symbol, eventRef);
  if ((type.flags & ts.TypeFlags.TemplateLiteral) === 0) return null;
  const { texts } = type as ts.TemplateLiteralType;
  return `^${texts.map(escapeRegex).join(".+")}$`;
}

function eventDocOf(checker: ts.TypeChecker, eventRef: ts.Expression): string | null {
  const text = ts.displayPartsToString(
    checker.getSymbolAtLocation(eventRef)?.getDocumentationComment(checker),
  );
  return text === "" ? null : text;
}

function toRegistration(checker: ts.TypeChecker, call: ts.CallExpression): Registration | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  if (method !== "on" && method !== "onAny") return null;
  const options = call.arguments[method === "on" ? 1 : 0];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return null;
  const eventRef = property(options, "event");
  if (eventRef === undefined) return null;
  const stateArg = method === "on" ? call.arguments[0] : undefined;
  return {
    kind: method,
    state: stateArg === undefined ? null : literalProperty(checker, stateArg, "name"),
    event: literalProperty(checker, eventRef, "type"),
    eventPattern: templatePattern(checker, eventRef),
    eventDoc: eventDocOf(checker, eventRef),
    eventRef,
    handler: property(options, "handler"),
    call,
    doc: callDoc(call),
  };
}

export function locationOf(node: ts.Node, root: string): VizLocation {
  const sourceFile = node.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: relative(root, sourceFile.fileName).split(sep).join("/"),
    line: position.line + 1,
    column: position.character + 1,
  };
}

/** Name literal of `state("x")()` / `state("x")().final()` / `event("X")()`, with which builder it came from. */
function declaredName(init: ts.Expression): { builder: string; name: string } | null {
  let call = init;
  while (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "final"
  )
    call = call.expression.expression;
  if (!ts.isCallExpression(call) || !ts.isCallExpression(call.expression)) return null;
  const builder = call.expression.expression;
  const [name] = call.expression.arguments;
  if (!ts.isIdentifier(builder) || name === undefined || !ts.isStringLiteralLike(name)) return null;
  return { builder: builder.text, name: name.text };
}

function collectDeclarationDocs(
  statement: ts.VariableStatement,
  docs: { stateDocs: Map<string, string>; eventDocs: Map<string, string> },
): void {
  const doc = docOf(statement);
  if (doc === null) return;
  for (const declaration of statement.declarationList.declarations) {
    const declared = declaration.initializer && declaredName(declaration.initializer);
    if (!declared) continue;
    if (declared.builder === "state") docs.stateDocs.set(declared.name, doc);
    if (declared.builder === "event") docs.eventDocs.set(declared.name, doc);
  }
}

function readFile(checker: ts.TypeChecker, sourceFile: ts.SourceFile): FileRead {
  const registrations: Registration[] = [];
  const stateDocs = new Map<string, string>();
  const eventDocs = new Map<string, string>();
  const effectDocs = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    const found = ts.isCallExpression(node) ? toRegistration(checker, node) : null;
    if (found) registrations.push(found);
    if (ts.isVariableStatement(node)) collectDeclarationDocs(node, { stateDocs, eventDocs });
    ts.forEachChild(node, visit);
    // After the children, so a chained `.effect` link follows the links before it.
    if (ts.isCallExpression(node)) collectEffectDoc(checker, node, effectDocs);
  };
  visit(sourceFile);
  return { registrations, stateDocs, eventDocs, effectDocs };
}

export interface LoadSourceOptions {
  /** Programs shared by one build or dev server. Default: a program for this call only. */
  programs?: ProgramStore | undefined;
}

/**
 * Type-check one file and collect its handler registrations, plus those of the
 * program's other source files. Any compiler failure becomes a Left reason; it
 * never throws.
 */
export function loadSource(
  source: AnalysisSource,
  options: LoadSourceOptions = {},
): Either<string, LoadedSource> {
  const store = options.programs ?? createProgramStore();
  const loaded = Either.from(() => {
    const compiler = compilerOptions(source);
    const program = programFor(store, { file: source.file, compilerOptions: compiler });
    const sourceFile = program.getSourceFile(source.file);
    if (sourceFile === undefined) return `source not found: ${source.file}`;
    const checker = program.getTypeChecker();
    const depths = importDepths(program, { root: sourceFile, options: compiler });
    const called = calledFiles(checker, sourceFile);
    const elsewhere = program
      .getSourceFiles()
      .filter(
        (other) =>
          other !== sourceFile &&
          !other.isDeclarationFile &&
          !other.fileName.includes("/node_modules/"),
      )
      .map((other) => ({
        file: relative(source.root, other.fileName).split(sep).join("/"),
        depth:
          (called.has(other.fileName) ? depths.get(other.fileName) : undefined) ??
          Number.MAX_SAFE_INTEGER,
        ...readFile(checker, other),
      }))
      .filter((other) => other.registrations.length > 0);
    return { checker, sourceFile, root: source.root, elsewhere, ...readFile(checker, sourceFile) };
  });
  if (Either.isLeft(loaded)) return Either.left(`compiler failed: ${String(loaded[0])}`);
  const value = loaded[1];
  return typeof value === "string" ? Either.left(value) : Either.right(value);
}
