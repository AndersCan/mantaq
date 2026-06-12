export function event<const T extends string>(id: T) {
  return <Payload>() => {
    return new EventRef<T, Payload>(id);
  };
}

export type AnyEventRef = EventRef<string>;

export type InternalEvent = { id: string } & Record<string, unknown>;

export class EventRef<const T extends string, Payload = unknown> {
  id: T;

  constructor(id: T) {
    this.id = id;
  }

  is(anyEvent: unknown): anyEvent is Payload & { id: T } {
    return (
      !!anyEvent &&
      typeof anyEvent === "object" &&
      "id" in anyEvent &&
      (anyEvent as { id: string }).id === this.id
    );
  }

  create(payload: Payload): Payload & { id: T } {
    if (payload === null || (typeof payload !== "object" && typeof payload !== "function")) {
      // Primitive payloads are wrapped as { id, value } at runtime; the intersection type can't be expressed statically
      return { id: this.id, value: payload } as unknown as Payload & { id: T };
    }
    return { ...(payload as Record<string, unknown>), id: this.id } as Payload & { id: T };
  }
}
