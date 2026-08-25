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

  constructor(type: T) {
    this.type = type;
  }

  /**
   * Type guard that matches an event by its `type` tag **only**.
   *
   * `is()` does **not** validate the payload. The `Payload` generic is erased at
   * runtime, so there is no way to confirm the payload's shape — or even its
   * presence — here. Narrowing is therefore limited to the type tag
   * (`{ type: T }`). After `if (ref.is(e))`, `e` is narrowed to `{ type: T }`;
   * reading `e.payload` is a compile error rather than a runtime surprise.
   *
   * This keeps the guard sound. Code that needs the payload must read it from an
   * event that is already correctly typed (e.g. one produced by `create()`) or
   * validate it explicitly. A guard that can't inspect the payload must not
   * promise one — that is the very soundness gap this closes.
   */
  is(anyEvent: unknown): anyEvent is { type: T } {
    return (
      !!anyEvent &&
      typeof anyEvent === "object" &&
      "type" in anyEvent &&
      (anyEvent as { type: string }).type === this.type
    );
  }

  create(): Payload extends void ? { type: T } : void;
  create(payload: Payload): Payload extends void ? { type: T } : { type: T; payload: Payload };
  create(payload?: Payload): void | { type: T } | { type: T; payload: Payload } {
    return payload === undefined ? { type: this.type } : { type: this.type, payload };
  }
}
