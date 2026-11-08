import type { VizMachine } from "@mantaq/viz";
import { dirname } from "node:path";
import ts from "typescript";
import { locationOf } from "./program.ts";

/** App code that can send an event to one machine when another machine's output or change fires. */
export interface Wire {
  /** Machine whose output or change is listened to. */
  from: string;
  /** Machine the found `send` goes to. */
  to: string;
  /** Output event id from the guard, "output" when no guard names one, "change" for change listeners. */
  trigger: string;
  /** Input event id sent. */
  event: string;
  /** "<file relative to root, / separators>:<line>" of the call in the listener that leads to the send. */
  at: string;
}

const ACTOR_KEYS = ["send", "snapshot", "inject", "settled"];
const MAX_DEPTH = 2;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function hasAll(type: ts.Type, keys: ReadonlyArray<string>): boolean {
  return keys.every((key) => type.getProperty(key) !== undefined);
}

function keep(name: string): boolean {
  const path = name.replaceAll("\\", "/");
  return !path.endsWith(".d.ts") && !path.includes("/node_modules/") && !TEST_FILE.test(path);
}

/** Program files by tsconfig; files without one share a group with no config. */
function groups(
  files: ReadonlyArray<string>,
): Array<{ config: string | undefined; names: string[] }> {
  const byConfig = new Map<string | undefined, string[]>();
  for (const file of files) {
    const config = ts.findConfigFile(dirname(file), (path) => ts.sys.fileExists(path));
    byConfig.set(config, [...(byConfig.get(config) ?? []), file]);
  }
  return [...byConfig].map(([config, own]) => {
    if (config === undefined) return { config, names: own };
    const read = ts.readConfigFile(config, (path) => ts.sys.readFile(path));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config));
    return { config, names: [...new Set([...parsed.fileNames, ...own])].filter(keep) };
  });
}

function optionsOf(config: string | undefined): ts.CompilerOptions {
  if (config === undefined) return { strict: true, allowImportingTsExtensions: true, noEmit: true };
  const read = ts.readConfigFile(config, (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config)).options;
}

function callsIn(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (each: ts.Node): void => {
    if (ts.isCallExpression(each)) found.push(each);
    ts.forEachChild(each, visit);
  };
  visit(node);
  return found;
}

function stringLiteralOf(node: ts.Node): string | null {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

/** Event ids `send` accepts, or null when `expr` is not an actor with literal event types. */
function inputIds(checker: ts.TypeChecker, expr: ts.Expression): Set<string> | null {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(expr));
  if (!hasAll(type, ACTOR_KEYS)) return null;
  const send = type.getProperty("send");
  if (send === undefined) return null;
  const signature = checker
    .getSignaturesOfType(checker.getTypeOfSymbolAtLocation(send, expr), ts.SignatureKind.Call)
    .at(0);
  const parameter = signature?.parameters[0];
  if (parameter === undefined) return null;
  const parameterType = checker.getTypeOfSymbolAtLocation(parameter, expr);
  const members = parameterType.isUnion() ? parameterType.types : [parameterType];
  const ids = new Set<string>();
  for (const member of members) {
    const property = member.getProperty("type");
    const literal = property && checker.getTypeOfSymbolAtLocation(property, expr);
    if (literal === undefined || !literal.isStringLiteral()) return null;
    ids.add(literal.value);
  }
  return ids.size === 0 ? null : ids;
}

function machineIn(
  checker: ts.TypeChecker,
  expr: ts.Expression,
  machines: ReadonlyArray<VizMachine>,
): string | null {
  const wanted = inputIds(checker, expr);
  if (wanted === null) return null;
  const own = (machine: VizMachine) =>
    new Set(machine.events.filter((each) => !each.internal).map((each) => each.id));
  const candidates = machines.filter((machine) => {
    const have = own(machine);
    return [...wanted].every((id) => have.has(id));
  });
  const exact = candidates.filter((machine) => own(machine).size === wanted.size);
  if (exact.length === 1) return exact[0]?.id ?? null;
  return candidates.length === 1 ? (candidates[0]?.id ?? null) : null;
}

function resolved(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  return symbol !== undefined && symbol.getFlags() & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function calleeSymbol(checker: ts.TypeChecker, call: ts.CallExpression): ts.Symbol | undefined {
  const callee = call.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  return resolved(checker, checker.getSymbolAtLocation(name));
}

/** The body of a function-like declaration, or null for other declarations and library code. */
function bodyOfDeclaration(declaration: ts.Declaration | undefined): ts.Node | null {
  if (declaration === undefined) return null;
  const file = declaration.getSourceFile();
  if (file.isDeclarationFile || file.fileName.includes("/node_modules/")) return null;
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
    return declaration.body ?? null;
  if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
    const init = declaration.initializer;
    if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
      return init.body;
  }
  return null;
}

function bodyOf(checker: ts.TypeChecker, call: ts.CallExpression): ts.Node | null {
  return bodyOfDeclaration(calleeSymbol(checker, call)?.valueDeclaration);
}

interface Found {
  to: string;
  event: string;
}

interface Scan {
  checker: ts.TypeChecker;
  machines: ReadonlyArray<VizMachine>;
}

function sendsFrom(scan: Scan, call: ts.CallExpression, depth: number): Found[] {
  const { checker, machines } = scan;
  const found: Found[] = [];
  const callee = call.expression;
  const [arg] = call.arguments;
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "send" && arg !== undefined) {
    const to = machineIn(checker, callee.expression, machines);
    const property = checker.getTypeAtLocation(arg).getProperty("type");
    const literal =
      property === undefined ? undefined : checker.getTypeOfSymbolAtLocation(property, arg);
    if (to !== null && literal?.isStringLiteral()) found.push({ to, event: literal.value });
  }
  if (depth >= MAX_DEPTH) return found;
  const body = bodyOf(checker, call);
  if (body === null) return found;
  for (const inner of callsIn(body)) found.push(...sendsFrom(scan, inner, depth + 1));
  return found;
}

function guardLiteral(condition: ts.Expression, outputs: ReadonlyArray<string>): string | null {
  const literals: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      const sides = [node.left, node.right];
      const typed = sides.some(
        (side) => ts.isPropertyAccessExpression(side) && side.name.text === "type",
      );
      const literal = sides.map(stringLiteralOf).find((text) => text !== null);
      if (typed && literal != null && outputs.includes(literal)) literals.push(literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(condition);
  return literals[0] ?? null;
}

function triggerOf(
  call: ts.CallExpression,
  listener: ts.Node,
  outputs: ReadonlyArray<string>,
): string {
  for (
    let node: ts.Node | undefined = call.parent;
    node !== undefined && node !== listener;
    node = node.parent
  ) {
    if (
      ts.isIfStatement(node) &&
      call.pos >= node.thenStatement.pos &&
      call.end <= node.thenStatement.end
    ) {
      const literal = guardLiteral(node.expression, outputs);
      if (literal !== null) return literal;
    }
  }
  return "output";
}

interface Listener {
  source: ts.Expression;
  kind: "output" | "change";
  /** Function bodies (or expressions) that run on the event. */
  bodies: ts.Node[];
}

function functionBody(checker: ts.TypeChecker, expr: ts.Expression): ts.Node | null {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr.body;
  if (!ts.isIdentifier(expr)) return null;
  return bodyOfDeclaration(resolved(checker, checker.getSymbolAtLocation(expr))?.valueDeclaration);
}

function onOutputListener(checker: ts.TypeChecker, call: ts.CallExpression): Listener | null {
  const [source, ...rest] = call.arguments;
  if (!ts.isIdentifier(call.expression) || source === undefined || rest.length === 0) return null;
  const declaration = resolved(
    checker,
    checker.getSymbolAtLocation(call.expression),
  )?.valueDeclaration;
  if (declaration === undefined || !ts.isFunctionDeclaration(declaration)) return null;
  if (declaration.name?.text !== "onOutput") return null;
  return {
    source,
    kind: "output",
    bodies: rest.flatMap((each) => functionBody(checker, each) ?? []),
  };
}

function onListener(checker: ts.TypeChecker, call: ts.CallExpression): Listener | null {
  const callee = call.expression;
  const [first, second] = call.arguments;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "on") return null;
  const kind = first === undefined ? null : stringLiteralOf(first);
  if ((kind !== "output" && kind !== "change") || second === undefined) return null;
  if (!ts.isObjectLiteralExpression(second)) return null;
  const handler = second.properties.find(
    (each): each is ts.PropertyAssignment =>
      ts.isPropertyAssignment(each) && ts.isIdentifier(each.name) && each.name.text === "fn",
  );
  const body = handler === undefined ? null : functionBody(checker, handler.initializer);
  return { source: callee.expression, kind, bodies: body === null ? [] : [body] };
}

function listenerOf(checker: ts.TypeChecker, call: ts.CallExpression): Listener | null {
  return onOutputListener(checker, call) ?? onListener(checker, call);
}

function wiresOf(scan: Scan, root: string, sourceFile: ts.SourceFile): Wire[] {
  const { checker, machines } = scan;
  return callsIn(sourceFile).flatMap((call) => {
    const listener = listenerOf(checker, call);
    if (listener === null) return [];
    const from = machineIn(checker, listener.source, machines);
    if (from === null) return [];
    const outputs = machines.find((machine) => machine.id === from)?.outputs ?? [];
    return listener.bodies.flatMap((body) =>
      callsIn(body).flatMap((entry) => {
        const at = locationOf(entry, root);
        const trigger = listener.kind === "change" ? "change" : triggerOf(entry, body, outputs);
        return sendsFrom(scan, entry, 0).map((found) => ({
          from,
          to: found.to,
          trigger,
          event: found.event,
          at: `${at.file}:${at.line}`,
        }));
      }),
    );
  });
}

/**
 * Connections between machines made in app code: a listener on one machine's
 * output or change that can send an event to another machine, at most two
 * calls away. Read with the TypeScript checker; nothing is run.
 */
export function findWires(context: {
  root: string;
  /** Absolute machine files given to mantaqViz. */
  files: ReadonlyArray<string>;
  machines: ReadonlyArray<VizMachine>;
}): Wire[] {
  const { root, files, machines } = context;
  if (machines.length === 0) return [];
  const all = groups(files).flatMap(({ config, names }) => {
    const program = ts.createProgram(names, optionsOf(config));
    const scan = { checker: program.getTypeChecker(), machines };
    return names.flatMap((name) => {
      const sourceFile = program.getSourceFile(name);
      return sourceFile === undefined ? [] : wiresOf(scan, root, sourceFile);
    });
  });
  const keyOf = (wire: Wire) =>
    JSON.stringify([wire.from, wire.to, wire.at, wire.event, wire.trigger]);
  return [...new Map(all.map((wire) => [keyOf(wire), wire])).values()]
    .filter((wire) => wire.from !== wire.to)
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}
