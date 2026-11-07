import type { VizField, VizJson } from "@mantaq/viz";
import ts from "typescript";
import type { LoadedSource } from "./program.ts";

/** Most samples one type yields; unions and object variants stop here. */
const MAX_SAMPLES = 8;
/** Deepest nesting followed; deeper values become null. */
const MAX_DEPTH = 5;

export interface Walk {
  checker: ts.TypeChecker;
  node: ts.Node;
  depth: number;
}

function unique(values: ReadonlyArray<VizJson>): VizJson[] {
  const seen = new Set<string>();
  return values
    .filter((value) => {
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SAMPLES);
}

function primitiveSamples(type: ts.Type, checker: ts.TypeChecker): VizJson[] | null {
  if (type.isStringLiteral()) return [type.value];
  if (type.isNumberLiteral()) return [type.value];
  const flags = type.getFlags();
  if (flags & ts.TypeFlags.BooleanLiteral) return [checker.typeToString(type) === "true"];
  if (flags & ts.TypeFlags.StringLike) return ["sample"];
  if (flags & ts.TypeFlags.NumberLike) return [1];
  if (flags & ts.TypeFlags.BigIntLike) return [1];
  if (flags & ts.TypeFlags.Null) return [null];
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return [null];
  return null;
}

/**
 * One value per property from its first sample, plus one variant per further
 * sample of each property: a union of literals in one field shows up as
 * separate payloads without multiplying across fields.
 */
function objectSamples(type: ts.Type, walk: Walk): VizJson[] {
  const fields = walk.checker
    .getPropertiesOfType(type)
    .flatMap((symbol): Array<{ name: string; samples: VizJson[] }> => {
      const fieldType = walk.checker.getTypeOfSymbolAtLocation(symbol, walk.node);
      if (walk.checker.getSignaturesOfType(fieldType, ts.SignatureKind.Call).length > 0) return [];
      const optional = (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0;
      const samples = samplesOf(walk.checker.getNonNullableType(fieldType), {
        ...walk,
        depth: walk.depth + 1,
      });
      return optional && samples.length === 0 ? [] : [{ name: symbol.getName(), samples }];
    });
  const base = Object.fromEntries(fields.map((field) => [field.name, field.samples[0] ?? null]));
  const variants = fields.flatMap((field) =>
    field.samples.slice(1).map((sample) => ({ ...base, [field.name]: sample })),
  );
  return unique([base, ...variants]);
}

/** JSON samples a value of `type` could take. Empty when the type has no JSON form (void, functions). */
function samplesOf(type: ts.Type, walk: Walk): VizJson[] {
  if (walk.depth > MAX_DEPTH) return [null];
  const flags = type.getFlags();
  if (flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) return [];
  // `boolean` is the union `true | false`, so it yields both.
  if (type.isUnion()) return unique(type.types.flatMap((member) => samplesOf(member, walk)));
  const { checker } = walk;
  const primitive = primitiveSamples(type, checker);
  if (primitive !== null) return primitive;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    const first =
      element === undefined ? undefined : samplesOf(element, { ...walk, depth: walk.depth + 1 })[0];
    return [first === undefined ? [] : [first]];
  }
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return [];
  return flags & ts.TypeFlags.Object || type.isIntersection() ? objectSamples(type, walk) : [null];
}

function literalValue(type: ts.Type, checker: ts.TypeChecker): VizJson | undefined {
  if (type.isStringLiteral()) return type.value;
  if (type.isNumberLiteral()) return type.value;
  if (type.getFlags() & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type) === "true";
  return undefined;
}

/** Literal members of a union (or the one literal), or null when any member is not a literal. */
function literalChoices(type: ts.Type, checker: ts.TypeChecker): VizJson[] | null {
  const members = type.isUnion() ? type.types : [type];
  const values = members.map((member) => literalValue(member, checker));
  const literals = values.filter((value) => value !== undefined);
  return literals.length === values.length && literals.length > 0 ? literals : null;
}

function inputOf(type: ts.Type, checker: ts.TypeChecker): Pick<VizField, "input" | "choices"> {
  const choices = literalChoices(type, checker);
  if (choices !== null) return { input: "choice", choices };
  const flags = type.getFlags();
  if (!type.isUnion() && flags & ts.TypeFlags.StringLike) return { input: "text", choices: [] };
  if (!type.isUnion() && flags & ts.TypeFlags.NumberLike) return { input: "number", choices: [] };
  return { input: "json", choices: [] };
}

/**
 * Top-level fields of an object type, in declaration order, with their doc
 * comment and how a form should ask for them. Null when the type is not a
 * plain object type. Function-typed properties are skipped.
 */
export function fieldsOf(type: ts.Type, walk: Walk): VizField[] | null {
  const { checker } = walk;
  const plain =
    (type.getFlags() & ts.TypeFlags.Object || type.isIntersection()) &&
    !checker.isArrayType(type) &&
    !checker.isTupleType(type) &&
    checker.getSignaturesOfType(type, ts.SignatureKind.Call).length === 0;
  if (!plain) return null;
  return checker.getPropertiesOfType(type).flatMap((symbol): VizField[] => {
    const fieldType = checker.getTypeOfSymbolAtLocation(symbol, walk.node);
    if (checker.getSignaturesOfType(fieldType, ts.SignatureKind.Call).length > 0) return [];
    const plainType = checker.getNonNullableType(fieldType);
    const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker));
    return [
      {
        name: symbol.getName(),
        type: checker.typeToString(plainType),
        optional: (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0,
        doc: doc === "" ? null : doc,
        ...inputOf(plainType, checker),
        sample: samplesOf(plainType, { ...walk, depth: walk.depth + 1 })[0] ?? null,
      },
    ];
  });
}

/** Payload fields per event, read from the same payload types as the samples. */
export function payloadFields(loaded: LoadedSource): Map<string, VizField[]> {
  return new Map(
    loaded.registrations.flatMap((registration): Array<[string, VizField[]]> => {
      if (registration.event === null) return [];
      const type = payloadType(loaded.checker, registration.eventRef);
      if (type === null) return [];
      const fields = fieldsOf(type, {
        checker: loaded.checker,
        node: registration.eventRef,
        depth: 0,
      });
      return fields === null ? [] : [[registration.event, fields]];
    }),
  );
}

/** Payload type of an EventRef: the parameter of its one-argument `create` overload. */
function payloadType(checker: ts.TypeChecker, eventRef: ts.Expression): ts.Type | null {
  const create = checker.getTypeAtLocation(eventRef).getProperty("create");
  if (create === undefined) return null;
  const signatures = checker.getSignaturesOfType(
    checker.getTypeOfSymbolAtLocation(create, eventRef),
    ts.SignatureKind.Call,
  );
  const parameter = signatures.find((signature) => signature.parameters.length === 1)
    ?.parameters[0];
  return parameter === undefined ? null : checker.getTypeOfSymbolAtLocation(parameter, eventRef);
}

/**
 * Sample payloads per event, read from the payload types of the events the
 * file's handlers register (`event("x")<{ ... }>()`). Events without a payload
 * are left out, as the fuzzer expects.
 */
export function payloadSamples(loaded: LoadedSource): Record<string, VizJson[]> {
  const entries = loaded.registrations.flatMap((registration): Array<[string, VizJson[]]> => {
    if (registration.event === null) return [];
    const type = payloadType(loaded.checker, registration.eventRef);
    if (type === null) return [];
    const samples = samplesOf(type, {
      checker: loaded.checker,
      node: registration.eventRef,
      depth: 0,
    });
    return samples.length === 0 ? [] : [[registration.event, samples]];
  });
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}
