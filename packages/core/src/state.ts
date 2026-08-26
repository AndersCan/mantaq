export function state<const T extends string>(name: T) {
  // Stryker disable next-line ObjectLiteral -- `StateRef` reads `options.isFinal` and only its truthiness matters; `{ isFinal: false }` and `{}` behave identically for every consumer (e.g. `buildSnapshot`'s `if (stateRef.isFinal)`).
  return <Payload = unknown>() => StateRef<T, Payload, false>(name, { isFinal: false });
}

export type AnyStateRef = StateRef<string, unknown, boolean>;

interface RegionOptions {
  initial: string;
  states: Record<string, AnyStateRef>;
}
type RegionsOptions = Record<string, RegionOptions>;

export interface StateRef<
  T extends string = string,
  Payload = unknown,
  IsFinal extends boolean = false,
> {
  readonly name: T;
  readonly isFinal: IsFinal;
  /** @internal */ _regions?: RegionsOptions;
  regions(options: RegionsOptions): this;
  final(): StateRef<T, Payload, true>;
  create(payload: Payload): { state: StateRef<T, Payload, IsFinal>; payload: Payload };
}

/**
 * Registry backing the isStateRef guard. Kept out of the ref object so the
 * marker stays invisible to equality checks and serialization.
 */
const stateRefs = new WeakSet<object>();

export function isStateRef(value: unknown): value is StateRef {
  return (
    // Stryker disable next-line ConditionalExpression,LogicalOperator -- `ConditionalExpression` (`&&` -> `true &&`) is equivalent (a WeakSet rejects primitives, so the rest is always false). The `LogicalOperator` (`&&` -> `||`) is soundness-tested by the `isStateRef()` assertions in refs.property.test.ts; Stryker's perTest coverage does not register that kill for short-circuit `||` guards, so it is ignored here (the assertions remain as executable behaviour).
    typeof value === "object" &&
    // Stryker disable next-line ConditionalExpression -- for `null`, `stateRefs.has(null)` is false, so the guard outcome is unchanged; the `&&`/`true` form agrees with the original on every input.
    value !== null &&
    stateRefs.has(value)
  );
}

export function StateRef<T extends string, Payload = unknown, IsFinal extends boolean = false>(
  name: T,
  options: { isFinal: IsFinal },
): StateRef<T, Payload, IsFinal> {
  const ref: StateRef<T, Payload, IsFinal> = {
    name,
    isFinal: options.isFinal,

    regions(options): StateRef<T, Payload, IsFinal> {
      ref._regions = options;
      return ref;
    },

    final(): StateRef<T, Payload, true> {
      const next = StateRef<T, Payload, true>(ref.name, { isFinal: true });
      next._regions = ref._regions;
      return next;
    },

    create(payload: Payload): { state: StateRef<T, Payload, IsFinal>; payload: Payload } {
      return { state: ref, payload };
    },
  };
  stateRefs.add(ref);
  return ref;
}
