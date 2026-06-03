export type AnyStateRef = StateRef<string>;

export function state<const T extends string>(id: T) {
  // TODO: Add Payload type here that adds requirements on Event payload (Can not transition to state unless Event has XYZ fields)
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
  // TODO: Hack to expose Payload type
  __payload: Payload | undefined;
  isFinal = false;
  _regions: RegionsOptions | undefined;

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
