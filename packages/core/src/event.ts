/**
 * Per-type brand. `create()` stamps a non-enumerable symbol keyed by the event
 * type onto the envelope, and `is()` checks for it. Non-enumerable keeps the
 * brand invisible to `toEqual`, JSON and spreads. A hand-built envelope
 * carrying only the wire fields has no brand, so `is()` rejects it, making the
 * type guard sound without walking the payload at runtime (see #240 / #262).
 *
 * `Symbol.for` keeps the brand per type without module-level state.
 */
function brandFor(type: string): symbol {
  return Symbol.for(`mantaq:event:${type}`);
}

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
    return typeof anyEvent === "object" && anyEvent !== null && Object.hasOwn(anyEvent, brand);
  };
  function create(): Payload extends void ? { type: T } : void;
  function create(
    payload: Payload,
  ): Payload extends void ? { type: T } : { type: T; payload: Payload };
  function create(payload?: Payload): unknown {
    const envelope = payload === undefined ? { type } : { type, payload };
    // Stryker disable next-line ObjectLiteral,BooleanLiteral -- is() checks only that the brand is present (`Object.hasOwn`), never its value, so every mutant of the descriptor is equivalent.
    return Object.defineProperty(envelope, brand, { value: true });
  }

  return { type, is: matchesBrand, create };
}
