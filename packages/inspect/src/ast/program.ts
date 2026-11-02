import type { VizLocation } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { dirname, relative, sep } from "node:path";
import ts from "typescript";

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
  /** The `event:` expression: an EventRef, whose type carries the payload type. */
  eventRef: ts.Expression;
  handler: ts.Expression | undefined;
  call: ts.CallExpression;
  /** Leading JSDoc of the statement holding the call. null = none. */
  doc: string | null;
}

export interface LoadedSource {
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
  root: string;
  registrations: Registration[];
  /** Leading JSDoc by state name, from `const x = state("x")()` declarations. */
  stateDocs: Map<string, string>;
  /** Leading JSDoc by event type, from `const x = event("X")()` declarations. */
  eventDocs: Map<string, string>;
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

function compilerOptions(source: AnalysisSource): ts.CompilerOptions {
  const configPath =
    source.tsconfig ?? ts.findConfigFile(dirname(source.file), (path) => ts.sys.fileExists(path));
  if (configPath === undefined)
    return { strict: true, allowImportingTsExtensions: true, noEmit: true };
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath)).options;
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

/** Name literal of `state("x")()` / `event("X")()`, with which builder it came from. */
function declaredName(init: ts.Expression): { builder: string; name: string } | null {
  if (!ts.isCallExpression(init) || !ts.isCallExpression(init.expression)) return null;
  const builder = init.expression.expression;
  const [name] = init.expression.arguments;
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

/**
 * Type-check one file and collect its handler registrations. Any compiler
 * failure becomes a Left reason; it never throws.
 */
export function loadSource(source: AnalysisSource): Either<string, LoadedSource> {
  const loaded = Either.from(() => {
    const program = ts.createProgram([source.file], compilerOptions(source));
    const sourceFile = program.getSourceFile(source.file);
    if (sourceFile === undefined) return `source not found: ${source.file}`;
    const checker = program.getTypeChecker();
    const registrations: Registration[] = [];
    const stateDocs = new Map<string, string>();
    const eventDocs = new Map<string, string>();
    const visit = (node: ts.Node): void => {
      const found = ts.isCallExpression(node) ? toRegistration(checker, node) : null;
      if (found) registrations.push(found);
      if (ts.isVariableStatement(node)) collectDeclarationDocs(node, { stateDocs, eventDocs });
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return { checker, sourceFile, root: source.root, registrations, stateDocs, eventDocs };
  });
  if (Either.isLeft(loaded)) return Either.left(`compiler failed: ${String(loaded[0])}`);
  const value = loaded[1];
  return typeof value === "string" ? Either.left(value) : Either.right(value);
}
