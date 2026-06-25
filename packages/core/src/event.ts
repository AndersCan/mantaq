export function event<const T extends string>(id: T) {
  return <Payload extends object | void = void>() => new EventRef<T, Payload>(id);
}

export type AnyEventRef = EventRef<string, object | void>;
export type InternalEvent = { id: string } & Record<string, unknown>;

export type CreatedOfEvent<Id extends string, P> = P extends void ? { id: Id } : P & { id: Id };

export class EventRef<const T extends string, Payload extends object | void = void> {
  readonly id: T;

  constructor(id: T) {
    this.id = id;
  }

  is(anyEvent: unknown): anyEvent is CreatedOfEvent<T, Payload> {
    return (
      !!anyEvent &&
      typeof anyEvent === "object" &&
      "id" in anyEvent &&
      (anyEvent as { id: string }).id === this.id
    );
  }

  create(payload: Payload): CreatedOfEvent<T, Payload> {
    if (payload === undefined) {
      return { id: this.id } as CreatedOfEvent<T, Payload>;
    }
    return { ...(payload as object), id: this.id } as CreatedOfEvent<T, Payload>;
  }
}
