import type { VizField, VizJson } from "@mantaq/viz";
import ts from "typescript";
import { actorEventSamples, fieldsOf } from "./payloads.ts";
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
  /** Fields of the actor's context type. null = no declared fields, or not an object type. */
  context: VizField[] | null;
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

/** The actor type reached by `unwrap`. */
function actorTypeOf(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): ts.Type {
  const { type, unwrap, node } = context;
  const actor = unwrap === "self" ? undefined : type.getProperty("actor");
  return actor === undefined ? type : checker.getTypeOfSymbolAtLocation(actor, node);
}

/** Fields of the `context` property of the actor type reached by `unwrap`. */
function contextOf(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): VizField[] | null {
  const { node } = context;
  const actorType = actorTypeOf(checker, context);
  const property = actorType.getProperty("context");
  if (property === undefined) return null;
  const fields = fieldsOf(
    checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, node)),
    { checker, node, depth: 0 },
  );
  return fields === null || fields.length === 0 ? null : fields;
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
): { found: MachineExport; actor: ts.Type } | null {
  const target =
    symbol.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const type = checker.getTypeOfSymbolAtLocation(target, node);
  const name = symbol.getName();
  const self = unwrapOf(checker, type, node);
  if (self !== null) {
    const at = { type, unwrap: self, node };
    return {
      found: { name, call: "instance", unwrap: self, context: contextOf(checker, at) },
      actor: actorTypeOf(checker, at),
    };
  }
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
    const unwrap = unwrapOf(checker, signature.getReturnType(), node);
    const call = unwrap === null ? null : callOf(checker, signature, node);
    if (unwrap !== null && call !== null) {
      const at = { type: signature.getReturnType(), unwrap, node };
      return {
        found: { name, call, unwrap, context: contextOf(checker, at) },
        actor: actorTypeOf(checker, at),
      };
    }
  }
  return null;
}

function exportedMachines(loaded: LoadedSource): Array<{ found: MachineExport; actor: ts.Type }> {
  const { checker, sourceFile } = loaded;
  const module = checker.getSymbolAtLocation(sourceFile);
  if (module === undefined) return [];
  return checker
    .getExportsOfModule(module)
    .flatMap((symbol) => {
      const machine = machineExport(checker, symbol, sourceFile);
      return machine === null ? [] : [{ machine, at: symbol.declarations?.[0]?.getStart() ?? 0 }];
    })
    .sort((left, right) => left.at - right.at)
    .map(({ machine }) => machine);
}

/** Exports of the file that are actors or build one, in source order. */
export function machineExports(loaded: LoadedSource): MachineExport[] {
  return exportedMachines(loaded).map(({ found }) => found);
}

/**
 * Sample payloads per event the file's machines declare, read from each
 * actor's type. Covers handlers registered in another file, such as the
 * inbox and workers `createPool` builds.
 */
export function exportedPayloadSamples(loaded: LoadedSource): Record<string, VizJson[]> {
  return Object.fromEntries(
    exportedMachines(loaded).flatMap(({ actor }) =>
      actorEventSamples(loaded.checker, { actor, node: loaded.sourceFile }),
    ),
  );
}
