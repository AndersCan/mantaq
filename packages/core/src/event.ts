// Per-type brand registry. A unique symbol is minted for each event type so
// that `create()`-produced envelopes carry a private marker that only the
// matching `EventRef` can verify. A hand-built `{ type: "x" }` has no brand,
// so `is()` rejects it — making the type guard sound without walking the
// payload at runtime (see #240 / #262).
const brandByType = new Map<string, symbol>();

function brandFor(type: string): symbol {
  let brand = brandByType.get(type);
  if (!brand) {
    brand = Symbol(`mantaq:event:${type}`);
    brandByType.set(type, brand);
  }
  return brand;
}

export function event<const T extends string>(type: T) {
  return <Payload extends object | void = void>() => new EventRef<T, Payload>(type);
}

export type AnyEventRef = EventRef<string, object | void>;
export type InternalEvent = { type: string; payload?: unknown };

export type CreatedOfEvent<T extends string, P> = P extends void
  ? { type: T }
  : { type: T; payload: P };

export class EventRef<const T extends string, Payload extends object | void = void> {
  readonly type: T;
  private readonly brand: symbol;

  constructor(type: T) {
    this.type = type;
    this.brand = brandFor(type);
  }

  is(anyEvent: unknown): anyEvent is CreatedOfEvent<T, Payload> {
    return (
      !!anyEvent &&
      typeof anyEvent === "object" &&
      (anyEvent as Record<symbol, unknown>)[this.brand] === true
    );
  }

  create(): Payload extends void ? { type: T } : void;
  create(payload: Payload): Payload extends void ? { type: T } : { type: T; payload: Payload };
  create(payload?: Payload): void | { type: T } | { type: T; payload: Payload } {
    const envelope = (
      payload === undefined ? { type: this.type } : { type: this.type, payload }
    ) as CreatedOfEvent<T, Payload> & Record<symbol, unknown>;
    // The brand is non-enumerable so it stays out of the observable envelope
    // shape (toEqual, JSON, spreads) while remaining readable by is().
    Object.defineProperty(envelope, this.brand, {
      value: true,
      enumerable: false,
      configurable: true,
    });
    return envelope;
  }
}
