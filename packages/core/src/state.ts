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

export class StateRef<T, Payload = unknown> {
  name: T;
  /** @internal */ readonly __payload: Payload | undefined;
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
}

export class TransitionState<N extends string = string, P = unknown> {
  /** @internal */ readonly __stateRef: StateRef<N, P>;
  /** @internal */ readonly __payload: P;

  constructor(stateRef: StateRef<N, P>, payload: P) {
    this.__stateRef = stateRef;
    this.__payload = payload;
  }
}
