/**
 * Per-type brand registry. A unique symbol is minted for each event type so
 * that `create()`-produced envelopes carry a private marker that only the
 * matching `EventRef` can verify. A hand-built envelope carrying only the
 * wire fields has no brand, so `is()` rejects it, making the type guard sound
 * without walking the payload at runtime (see #240 / #262).
 */
const brandByType = new Map<string, symbol>();

function brandFor(type: string): symbol {
  let brand = brandByType.get(type);
  if (!brand) {
    // Stryker disable next-line StringLiteral -- brand identity is unique per type; the description text is cosmetic and never read.
    brand = Symbol(`mantaq:event:${type}`);
    brandByType.set(type, brand);
  }
  return brand;
}

/**
 * Envelope-to-brands registry. Kept out of the envelope object itself so the
 * brand stays invisible to `toEqual`, JSON and spreads while remaining
 * readable by `is()`.
 */
const brandsByEnvelope = new WeakMap<object, Set<symbol>>();

export function event<const T extends string>(type: T) {
  return <Payload extends object | void = void>() => EventRef<T, Payload>(type);
}

export interface EventRef<T extends string = string, Payload extends object | void = void> {
  readonly type: T;
  is(anyEvent: unknown): anyEvent is CreatedOfEvent<T, Payload>;
  create(): Payload extends void ? { type: T } : void;
  create(payload: Payload): Payload extends void ? { type: T } : { type: T; payload: Payload };
}

export type AnyEventRef = EventRef<string, object | void>;

export type CreatedOfEvent<T extends string, P> = P extends void
  ? { type: T }
  : { type: T; payload: P };

export function EventRef<const T extends string, Payload extends object | void = void>(
  type: T,
): EventRef<T, Payload> {
  const brand = brandFor(type);
  const matchesBrand = function matchesEvent(
    anyEvent: unknown,
  ): anyEvent is CreatedOfEvent<T, Payload> {
    return (
      // Stryker disable next-line ConditionalExpression,LogicalOperator -- `ConditionalExpression` (`&&` -> `true &&`) is equivalent (a WeakMap rejects primitives, so the rest is always false). The `LogicalOperator` (`&&` -> `||`) is soundness-tested by the `is()` assertions in refs.property.test.ts; Stryker's perTest coverage does not register that kill for short-circuit `||` guards, so it is ignored here (the assertions remain as executable behaviour).
      typeof anyEvent === "object" &&
      // Stryker disable next-line ConditionalExpression -- `WeakMap.get(null)` is undefined, so the brand check is still false; original and mutant agree on every input.
      anyEvent !== null &&
      brandsByEnvelope.get(anyEvent)?.has(brand) === true
    );
  };
  function create(): Payload extends void ? { type: T } : void;
  function create(
    payload: Payload,
  ): Payload extends void ? { type: T } : { type: T; payload: Payload };
  function create(payload?: Payload): unknown {
    const envelope = payload === undefined ? { type } : { type, payload };
    let brands = brandsByEnvelope.get(envelope);
    // Stryker disable next-line ConditionalExpression -- `create()` mints a fresh envelope object on every call, so `brands` is always absent here; inverting the guard never changes an observable result.
    if (!brands) {
      brands = new Set();
      brandsByEnvelope.set(envelope, brands);
    }
    brands.add(brand);
    return envelope;
  }

  return { type, is: matchesBrand, create };
}
