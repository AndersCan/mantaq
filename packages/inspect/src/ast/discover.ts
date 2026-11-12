import type { VizField, VizJson } from "@mantaq/viz";
import ts from "typescript";
import { fieldsOf, samplesOf } from "./payloads.ts";
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
  /** Sample payloads per event id, read from the actor's `send` type and the result's `events` refs. */
  samples: Record<string, VizJson[]>;
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

/** Fields of the `context` property of the actor type reached by `unwrap`. */
function contextOf(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): VizField[] | null {
  const { type, unwrap, node } = context;
  const actor = unwrap === "self" ? undefined : type.getProperty("actor");
  const actorType = actor === undefined ? type : checker.getTypeOfSymbolAtLocation(actor, node);
  const property = actorType?.getProperty("context");
  if (property === undefined) return null;
  const fields = fieldsOf(
    checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, node)),
    { checker, node, depth: 0 },
  );
  return fields === null || fields.length === 0 ? null : fields;
}

/** The event shapes a `{ type, payload }` union holds, one per member. */
function membersOf(type: ts.Type): ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

/** Event shapes the factory's result offers through an `events` map of event refs (`create` returns one). */
function refShapes(checker: ts.TypeChecker, context: { type: ts.Type; node: ts.Node }): ts.Type[] {
  const { type, node } = context;
  const events = type.getProperty("events");
  if (events === undefined) return [];
  return checker
    .getPropertiesOfType(checker.getTypeOfSymbolAtLocation(events, node))
    .flatMap((ref) => {
      const create = checker.getTypeOfSymbolAtLocation(ref, node).getProperty("create");
      if (create === undefined) return [];
      const signature = checker
        .getSignaturesOfType(checker.getTypeOfSymbolAtLocation(create, node), ts.SignatureKind.Call)
        .at(-1);
      return signature === undefined ? [] : [signature.getReturnType()];
    });
}

/**
 * Samples per event from the types the machine is built from: the union the
 * actor's `send` accepts and the refs in the result's `events` map. Each shape
 * needs a literal `type` and a `payload`. This covers machines built by a
 * helper, whose handlers are not registered in the inspected file.
 */
function samplesFromTypes(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): Record<string, VizJson[]> {
  const { type, unwrap, node } = context;
  const actor = unwrap === "self" ? undefined : type.getProperty("actor");
  const actorType = actor === undefined ? type : checker.getTypeOfSymbolAtLocation(actor, node);
  const send = actorType.getProperty("send");
  const parameter =
    send === undefined
      ? undefined
      : checker.getSignaturesOfType(
          checker.getTypeOfSymbolAtLocation(send, node),
          ts.SignatureKind.Call,
        )[0]?.parameters[0];
  const sendShapes =
    parameter === undefined ? [] : membersOf(checker.getTypeOfSymbolAtLocation(parameter, node));
  const shapes = [...sendShapes, ...refShapes(checker, { type, node })];
  const entries = shapes.flatMap((shape): Array<[string, VizJson[]]> => {
    const typeProperty = shape.getProperty("type");
    const payloadProperty = shape.getProperty("payload");
    if (typeProperty === undefined || payloadProperty === undefined) return [];
    const id = checker.getTypeOfSymbolAtLocation(typeProperty, node);
    if (!id.isStringLiteral()) return [];
    const samples = samplesOf(
      checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(payloadProperty, node)),
      { checker, node, depth: 0 },
    );
    return samples.length === 0 ? [] : [[id.value, samples]];
  });
  return Object.fromEntries(entries);
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
  if (self !== null) {
    return {
      name,
      call: "instance",
      unwrap: self,
      context: contextOf(checker, { type, unwrap: self, node }),
      samples: samplesFromTypes(checker, { type, unwrap: self, node }),
    };
  }
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
    const unwrap = unwrapOf(checker, signature.getReturnType(), node);
    const call = unwrap === null ? null : callOf(checker, signature, node);
    if (unwrap !== null && call !== null) {
      const returned = signature.getReturnType();
      const at = { type: returned, unwrap, node };
      return {
        name,
        call,
        unwrap,
        context: contextOf(checker, at),
        samples: samplesFromTypes(checker, at),
      };
    }
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
