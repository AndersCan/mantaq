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

  is(anyEvent: unknown): anyEvent is CreatedOfEvent<T, Payload> {
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
