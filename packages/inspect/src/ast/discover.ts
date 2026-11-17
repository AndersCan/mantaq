import type { VizField, VizJson } from "@mantaq/viz";
import ts from "typescript";
import { fieldsOf, samplesOf } from "./payloads.ts";
import type { LoadedSource } from "./program.ts";

/**
 * A `machine(id, { create })` export, read from its type alone (nothing is
 * called to find out): `id` is its literal id and `create({ clock })` builds
 * the actor on the clock inspect hands in.
 *
 * `unwrap`: the result is the actor (`self`) or carries it as `.actor`.
 */
export interface MachineExport {
  name: string;
  /** The literal id of the `machine(id, …)` export. */
  id: string;
  unwrap: "self" | "actor";
  /** Fields of the actor's context type. null = no declared fields, or not an object type. */
  context: VizField[] | null;
  /** Sample payloads per event id, read from the actor's `send` type and the result's `events` refs. */
  samples: Record<string, VizJson[]>;
  /** Payload fields per event id, from the same types as `samples`. */
  fields: Record<string, VizField[]>;
}

const ACTOR_KEYS = ["send", "snapshot", "inject", "settled"];

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

/** Event shapes the actors' `internal` event refs create, which effects emit and no `send` accepts. */
function internalShapes(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): ts.Type[] {
  const { node } = context;
  return actorTypes(checker, context).flatMap((actorType) => {
    const options = actorType.getProperty("options");
    const internal =
      options === undefined
        ? undefined
        : checker.getTypeOfSymbolAtLocation(options, node).getProperty("internal");
    if (internal === undefined) return [];
    const list = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(internal, node));
    const element = checker.getIndexTypeOfType(list, ts.IndexKind.Number);
    if (element === undefined) return [];
    return membersOf(element).flatMap((ref) => {
      const create = ref.getProperty("create");
      if (create === undefined) return [];
      const signature = checker
        .getSignaturesOfType(checker.getTypeOfSymbolAtLocation(create, node), ts.SignatureKind.Call)
        .at(-1);
      return signature === undefined ? [] : [signature.getReturnType()];
    });
  });
}

/** Actor types reached by `unwrap`, then every other actor the result carries next to it (a pool's inbox). */
function actorTypes(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): ts.Type[] {
  const { type, unwrap, node } = context;
  const actor = unwrap === "self" ? undefined : type.getProperty("actor");
  const main = actor === undefined ? type : checker.getTypeOfSymbolAtLocation(actor, node);
  const others = checker
    .getPropertiesOfType(type)
    .filter((property) => property.getName() !== "actor")
    .map((property) => checker.getTypeOfSymbolAtLocation(property, node));
  return [main, ...others];
}

/** Payload type per event id, from the unions the actors' `send` accepts and the refs in the result's `events` map. Each shape needs a literal `type` and a `payload`. */
function payloadTypes(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): Array<[string, ts.Type]> {
  const { type, node } = context;
  const sendShapes = actorTypes(checker, context).flatMap((actorType) => {
    const send = actorType.getProperty("send");
    const parameter =
      send === undefined
        ? undefined
        : checker.getSignaturesOfType(
            checker.getTypeOfSymbolAtLocation(send, node),
            ts.SignatureKind.Call,
          )[0]?.parameters[0];
    return parameter === undefined
      ? []
      : membersOf(checker.getTypeOfSymbolAtLocation(parameter, node));
  });
  return [
    ...sendShapes,
    ...refShapes(checker, { type, node }),
    ...internalShapes(checker, context),
  ].flatMap((shape): Array<[string, ts.Type]> => {
    const typeProperty = shape.getProperty("type");
    const payloadProperty = shape.getProperty("payload");
    if (typeProperty === undefined || payloadProperty === undefined) return [];
    const id = checker.getTypeOfSymbolAtLocation(typeProperty, node);
    if (!id.isStringLiteral()) return [];
    return [
      [
        id.value,
        checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(payloadProperty, node)),
      ],
    ];
  });
}

/**
 * Samples per event from the types the machine is built from. This covers
 * machines built by a helper, whose handlers are not registered in the
 * inspected file.
 */
function samplesFromTypes(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): Record<string, VizJson[]> {
  const entries = payloadTypes(checker, context).flatMap(
    ([id, payload]): Array<[string, VizJson[]]> => {
      const samples = samplesOf(payload, { checker, node: context.node, depth: 0 });
      return samples.length === 0 ? [] : [[id, samples]];
    },
  );
  return Object.fromEntries(entries);
}

/** The Context tab's fields per event, from the same payload types as the samples. */
function fieldsFromTypes(
  checker: ts.TypeChecker,
  context: { type: ts.Type; unwrap: MachineExport["unwrap"]; node: ts.Node },
): Record<string, VizField[]> {
  const entries = payloadTypes(checker, context).flatMap(
    ([id, payload]): Array<[string, VizField[]]> => {
      const fields = fieldsOf(payload, { checker, node: context.node, depth: 0 });
      return fields === null || fields.length === 0 ? [] : [[id, fields]];
    },
  );
  return Object.fromEntries(entries);
}

/** A `machine(id, { create })` value, read from the literal `id` and the actor `create` returns. */
function machineValue(
  checker: ts.TypeChecker,
  context: { type: ts.Type; name: string; node: ts.Node },
): MachineExport | undefined {
  const { type, name, node } = context;
  const idProperty = type.getProperty("id");
  const create = type.getProperty("create");
  if (idProperty === undefined || create === undefined) return undefined;
  const id = checker.getTypeOfSymbolAtLocation(idProperty, node);
  const signature = checker
    .getSignaturesOfType(checker.getTypeOfSymbolAtLocation(create, node), ts.SignatureKind.Call)
    .at(-1);
  if (signature === undefined || !id.isStringLiteral()) return undefined;
  const returned = signature.getReturnType();
  const unwrap = unwrapOf(checker, returned, node);
  if (unwrap === null) return undefined;
  const at = { type: returned, unwrap, node };
  return {
    name,
    id: id.value,
    unwrap,
    context: contextOf(checker, at),
    samples: samplesFromTypes(checker, at),
    fields: fieldsFromTypes(checker, at),
  };
}

function machineExport(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  node: ts.Node,
): MachineExport | null {
  const target =
    symbol.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const type = checker.getTypeOfSymbolAtLocation(target, node);
  return machineValue(checker, { type, name: symbol.getName(), node }) ?? null;
}

/** The `machine(...)` exports of the file, in source order. Nothing else counts: no factory, no bare actor. */
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
