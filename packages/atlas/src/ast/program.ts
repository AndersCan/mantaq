import type { AtlasLocation } from "../schema.ts";
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

/** One `m.on(state, { eventRef, handler })` or `m.onAny({ eventRef, handler })` call. */
export interface Registration {
  kind: "on" | "onAny";
  /** Resolved state name; null for onAny or when the type has no literal name. */
  state: string | null;
  event: string | null;
  handler: ts.Expression | undefined;
  call: ts.CallExpression;
}

export interface LoadedSource {
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
  root: string;
  registrations: Registration[];
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
  const eventRef = property(options, "eventRef");
  if (eventRef === undefined) return null;
  const stateArg = method === "on" ? call.arguments[0] : undefined;
  return {
    kind: method,
    state: stateArg === undefined ? null : literalProperty(checker, stateArg, "name"),
    event: literalProperty(checker, eventRef, "type"),
    handler: property(options, "handler"),
    call,
  };
}

export function locationOf(node: ts.Node, root: string): AtlasLocation {
  const sourceFile = node.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: relative(root, sourceFile.fileName).split(sep).join("/"),
    line: position.line + 1,
    column: position.character + 1,
  };
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
    const visit = (node: ts.Node): void => {
      const found = ts.isCallExpression(node) ? toRegistration(checker, node) : null;
      if (found) registrations.push(found);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return { checker, sourceFile, root: source.root, registrations };
  });
  if (Either.isLeft(loaded)) return Either.left(`compiler failed: ${String(loaded[0])}`);
  const value = loaded[1];
  return typeof value === "string" ? Either.left(value) : Either.right(value);
}
