export type AnyStateRef = StateRef<string, unknown, boolean>;

export function state<const T extends string>(id: T) {
  return <Payload>() => {
    return new StateRef<T, Payload, false>(id);
  };
}

interface RegionOptions<
  States extends Record<string, AnyStateRef> = Record<string, AnyStateRef>,
  K extends keyof States = string,
> {
  initial: K;
  states: States;
}

interface RegionsOptions<States extends Record<string, AnyStateRef> = Record<string, AnyStateRef>> {
  [key: string]: RegionOptions<States>;
}

export class StateRef<T extends string, _Payload = unknown, IsFinal extends boolean = false> {
  name: T;
  isFinal: IsFinal;
  /** @internal */ _regions: RegionsOptions | undefined;

  constructor(name: T, isFinal: IsFinal = false as IsFinal) {
    this.name = name;
    this.isFinal = isFinal;
  }

  regions<
    States extends Record<string, AnyStateRef> = Record<string, AnyStateRef>,
    K extends keyof States & string = string,
  >(options: Record<string, RegionOptions<States, K>>) {
    this._regions = options;
    return this;
  }

  final(): StateRef<T, _Payload, true> {
    const next = new StateRef<T, _Payload, true>(this.name, true);
    next._regions = this._regions;
    return next;
  }

  create(payload: _Payload): { state: StateRef<T, _Payload, IsFinal>; payload: _Payload } {
    return { state: this, payload };
  }
}
