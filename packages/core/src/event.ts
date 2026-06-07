export function event<const T extends string>(id: T) {
  return <Payload>() => {
    return new EventRef<T, Payload>(id);
  };
}

export type AnyEventRef = EventRef<string>;

export class EventRef<const T extends string, Payload = unknown> {
  id: T;
  payload: Payload | undefined;

  constructor(id: T) {
    this.id = id;
  }

  is(anyEvent: AnyEventRef): anyEvent is typeof this {
    return anyEvent && anyEvent.id === this.id;
  }

  create(payload: Payload): { id: T } & Payload {
    return { ...payload, id: this.id } as { id: T } & Payload;
  }
}
