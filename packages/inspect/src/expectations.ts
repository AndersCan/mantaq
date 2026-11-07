/** Listed keys must match; unlisted keys are ignored. Nested objects match the same way. Arrays and other values must be equal. `undefined`: the key is not set. */
export type ContextMatch<C> =
  C extends ReadonlyArray<unknown>
    ? C
    : C extends object
      ? { readonly [K in keyof C]?: ContextMatch<C[K]> | undefined }
      : C;

export interface StateExpectations<C> {
  /** Contexts that are a bug in this state: fuzzing fails when any run reaches one. */
  readonly neverSee?: ReadonlyArray<ContextMatch<C>>;
  /** Contexts some run must reach in this state: fuzzing fails when none does. */
  readonly mustSee?: ReadonlyArray<ContextMatch<C>>;
}

/** The actor a factory returns, or the actor itself. */
type ActorOf<M> = M extends (...args: never[]) => infer R
  ? R extends { actor: infer A }
    ? A
    : R
  : M;

/** Expectations for one machine, keyed by its state names. `Expectations<typeof createCheckoutActor>`. */
export type Expectations<M> =
  ActorOf<M> extends { state: { name: infer N extends string }; context: infer C }
    ? { readonly [S in Exclude<N, "__error">]?: StateExpectations<C> }
    : never;

/** What `inspect` accepts at runtime; `Expectations<…>` is assignable to it. */
export type AnyExpectations = Readonly<Record<string, StateExpectations<unknown>>>;

export type JsonPattern =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<JsonPattern>
  | { readonly [key: string]: JsonPattern | undefined };

export interface CheckedExpectation {
  kind: "neverSee" | "mustSee";
  state: string;
  /** Position as written. */
  index: number;
  pattern: JsonPattern;
  /** Printed form, `VizFailedExpectation.match`. */
  text: string;
  /** `never:${state}:${index}` | `must:${state}:${index}` */
  feature: string;
}

const FIELDS: ReadonlyArray<CheckedExpectation["kind"]> = ["neverSee", "mustSee"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A validated copy of plain JSON; object values may be `undefined` ("not set"). `undefined`: not plain JSON. */
function toPattern(
  value: unknown,
  ancestors: ReadonlyArray<unknown>,
): { readonly pattern: JsonPattern } | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { pattern: value };
  }
  if (typeof value === "number") return Number.isFinite(value) ? { pattern: value } : undefined;
  if (ancestors.includes(value)) return undefined;
  const inside = [...ancestors, value];
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => toPattern(item, inside));
    const kept = items.flatMap((each) => (each === undefined ? [] : [each.pattern]));
    return kept.length === items.length ? { pattern: kept } : undefined;
  }
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value).map(
    ([key, item]): [string, JsonPattern | undefined] | undefined => {
      if (item === undefined) return [key, undefined];
      const each = toPattern(item, inside);
      return each === undefined ? undefined : [key, each.pattern];
    },
  );
  const kept = entries.flatMap((each) => (each === undefined ? [] : [each]));
  return kept.length === entries.length ? { pattern: Object.fromEntries(kept) } : undefined;
}

function patternObject(
  pattern: JsonPattern | undefined,
): { readonly [key: string]: JsonPattern | undefined } | null {
  if (typeof pattern !== "object" || pattern === null || Array.isArray(pattern)) return null;
  return isPlainObject(pattern) ? pattern : null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, at) => jsonEqual(item, right[at]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && jsonEqual(left[key], right[key]))
    );
  }
  return left === right;
}

/** Whether `actual` is a context the pattern describes. Pure. */
export function matches(pattern: JsonPattern | undefined, actual: unknown): boolean {
  const object = patternObject(pattern);
  if (object === null) return jsonEqual(pattern, actual);
  const entries = Object.entries(object);
  if (entries.length === 0) return true;
  if (!isPlainObject(actual)) return false;
  return entries.every(([key, value]) =>
    value === undefined ? !(key in actual) : key in actual && matches(value, actual[key]),
  );
}

/** JSON form, except that `undefined` object values print as `undefined`. */
export function printPattern(pattern: JsonPattern | undefined): string {
  if (pattern === undefined) return "undefined";
  if (Array.isArray(pattern)) return JSON.stringify(pattern);
  const object = patternObject(pattern);
  if (object === null) return JSON.stringify(pattern);
  const body = Object.entries(object).map(
    ([key, value]) => `${JSON.stringify(key)}:${printPattern(value)}`,
  );
  return `{${body.join(",")}}`;
}

const NOT_OBJECT = "a context match is a plain object of JSON values";

function checkState(
  state: string,
  entry: unknown,
): { checked: CheckedExpectation[]; warnings: string[] } {
  if (!isPlainObject(entry)) {
    return {
      checked: [],
      warnings: [`expectations for ${state}: expected an object with neverSee or mustSee`],
    };
  }
  const warnings = Object.keys(entry)
    .filter((key) => !FIELDS.some((field) => field === key))
    .map(
      (key) =>
        `expectations for ${state}: unknown field "${key}" ignored (use neverSee or mustSee)`,
    );
  const checked: CheckedExpectation[] = [];
  for (const kind of FIELDS) {
    const list: unknown = entry[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      warnings.push(`expectations for ${state}: ${kind} must be a list`);
      continue;
    }
    for (const [index, item] of list.entries()) {
      const pattern = isPlainObject(item) ? toPattern(item, []) : undefined;
      if (pattern === undefined) {
        warnings.push(`expectations for ${state}: ${kind}[${index}] ignored: ${NOT_OBJECT}`);
        continue;
      }
      checked.push({
        kind,
        state,
        index,
        pattern: pattern.pattern,
        text: printPattern(pattern.pattern),
        feature: `${kind === "neverSee" ? "never" : "must"}:${state}:${index}`,
      });
    }
  }
  return { checked, warnings };
}

/**
 * Validate what the machine file wrote. `states` are the top-level state ids.
 * The bad part is ignored with a warning and the rest is still checked.
 */
export function checkExpectations(
  value: unknown,
  states: ReadonlyArray<string>,
): { checked: CheckedExpectation[]; warnings: string[] } {
  if (value === undefined) return { checked: [], warnings: [] };
  if (!isPlainObject(value)) {
    return {
      checked: [],
      warnings: ["expectations ignored: expected an object keyed by state name"],
    };
  }
  const unknown = Object.keys(value)
    .filter((key) => !states.includes(key))
    .map((key) => `expectations for unknown state "${key}" ignored`);
  const known = states.flatMap((state) =>
    state in value ? [checkState(state, value[state])] : [],
  );
  const order = (kind: CheckedExpectation["kind"]) => (kind === "neverSee" ? 0 : 1);
  return {
    checked: known
      .flatMap((each) => each.checked)
      .sort(
        (left, right) =>
          states.indexOf(left.state) - states.indexOf(right.state) ||
          order(left.kind) - order(right.kind) ||
          left.index - right.index,
      ),
    warnings: [...unknown, ...known.flatMap((each) => each.warnings)],
  };
}
