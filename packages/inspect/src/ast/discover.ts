import ts from "typescript";
import type { LoadedSource } from "./program.ts";

/**
 * How to get a fresh actor from an export, read from its type alone (nothing
 * is called to find out):
 * - `instance`: the export is an actor. It cannot be recreated, so it is
 *   drawn but not fuzzed.
 * - `call`: call it with no arguments.
 * - `clock`: call it with a VirtualClock.
 * - `options`: call it with `{ clock: VirtualClock }`.
 *
 * `unwrap`: the result is the actor (`self`) or carries it as `.actor`.
 */
export interface MachineExport {
  name: string;
  call: "instance" | "call" | "clock" | "options";
  unwrap: "self" | "actor";
}

const ACTOR_KEYS = ["send", "snapshot", "inject", "settled"];
const CLOCK_KEYS = ["setTimeout", "clearTimeout", "now"];

function hasAll(type: ts.Type, keys: ReadonlyArray<string>): boolean {
  return keys.every((key) => type.getProperty(key) !== undefined);
}

function unwrapOf(
  checker: ts.TypeChecker,
  type: ts.Type,
  node: ts.Node,
): MachineExport["unwrap"] | null {
  if (hasAll(type, ACTOR_KEYS)) return "self";
  const actor = type.getProperty("actor");
  if (actor === undefined) return null;
  return hasAll(checker.getTypeOfSymbolAtLocation(actor, node), ACTOR_KEYS) ? "actor" : null;
}

function isRequired(parameter: ts.Symbol): boolean {
  const declaration = parameter.valueDeclaration;
  return (
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    declaration.questionToken === undefined &&
    declaration.initializer === undefined &&
    declaration.dotDotDotToken === undefined
  );
}

/** How to call a factory so its actor runs on a clock we control, or null when it cannot be called bare. */
function callOf(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  node: ts.Node,
): MachineExport["call"] | null {
  const [first, ...rest] = signature.parameters;
  if (rest.some(isRequired)) return null;
  if (first === undefined) return "call";
  const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(first, node));
  if (hasAll(type, CLOCK_KEYS)) return "clock";
  const clock = type.getProperty("clock");
  if (clock !== undefined) {
    const clockType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(clock, node));
    if (hasAll(clockType, CLOCK_KEYS)) return "options";
  }
  return isRequired(first) ? null : "call";
}

function machineExport(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  node: ts.Node,
): MachineExport | null {
  const target =
    symbol.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const type = checker.getTypeOfSymbolAtLocation(target, node);
  const name = symbol.getName();
  const self = unwrapOf(checker, type, node);
  if (self !== null) return { name, call: "instance", unwrap: self };
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
    const unwrap = unwrapOf(checker, signature.getReturnType(), node);
    const call = unwrap === null ? null : callOf(checker, signature, node);
    if (unwrap !== null && call !== null) return { name, call, unwrap };
  }
  return null;
}

/** Exports of the file that are actors or build one, in source order. */
export function machineExports(loaded: LoadedSource): MachineExport[] {
  const { checker, sourceFile } = loaded;
  const module = checker.getSymbolAtLocation(sourceFile);
  if (module === undefined) return [];
  return checker
    .getExportsOfModule(module)
    .flatMap((symbol) => {
      const found = machineExport(checker, symbol, sourceFile);
      return found === null ? [] : [{ found, at: symbol.declarations?.[0]?.getStart() ?? 0 }];
    })
    .sort((left, right) => left.at - right.at)
    .map(({ found }) => found);
}
