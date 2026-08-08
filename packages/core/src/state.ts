export function state<const T extends string>(id: T) {
  return <Payload = unknown>() => new StateRef<T, Payload, false>(id, false);
}

export type AnyStateRef = StateRef<string, unknown, boolean>;

interface RegionOptions {
  initial: string;
  states: Record<string, AnyStateRef>;
}
export type RegionsOptions = Record<string, RegionOptions>;

export class StateRef<T extends string, Payload = unknown, IsFinal extends boolean = false> {
  readonly name: T;
  readonly isFinal: IsFinal;
  /** @internal */ _regions: RegionsOptions | undefined;

  constructor(name: T, isFinal: IsFinal) {
    this.name = name;
    this.isFinal = isFinal;
  }

  regions(options: RegionsOptions): this {
    this._regions = options;
    return this;
  }

  final(): StateRef<T, Payload, true> {
    const next = new StateRef<T, Payload, true>(this.name, true);
    next._regions = this._regions;
    return next;
  }

  create(payload: Payload): { state: StateRef<T, Payload, IsFinal>; payload: Payload } {
    return { state: this, payload };
  }
}
