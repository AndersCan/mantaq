export type AnyStateRef = StateRef<string>;

export function state<const T extends string>(id: T) {
  return <Payload>() => {
    return new StateRef<T, Payload>(id);
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

export class StateRef<T extends string, _Payload = unknown> {
  name: T;
  isFinal = false;
  /** @internal */ _regions: RegionsOptions | undefined;

  constructor(name: T) {
    this.name = name;
  }

  regions<
    States extends Record<string, AnyStateRef> = Record<string, AnyStateRef>,
    K extends keyof States & string = string,
  >(options: Record<string, RegionOptions<States, K>>) {
    this._regions = options;
    return this;
  }

  final() {
    this.isFinal = true;
    return this;
  }

  create(payload: _Payload): { state: StateRef<T, _Payload>; payload: _Payload } {
    return { state: this, payload };
  }
}
