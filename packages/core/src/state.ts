export type AnyStateRef = StateRef<string>;

export function state<T extends string>(name: T) {
  return new StateRef<T>(name);
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

export class StateRef<T> {
  name: T;
  isFinal = false;
  _region: RegionOptions | undefined;
  _regions: RegionsOptions | undefined;

  constructor(name: T) {
    this.name = name;
  }

  region<
    States extends Record<string, AnyStateRef> = Record<string, AnyStateRef>,
    K extends keyof States & string = string,
  >(options: RegionOptions<States, K>) {
    this._region = options;
    return this;
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
}
