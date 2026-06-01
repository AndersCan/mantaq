export type AnyStateRef = StateRef<string>;

export function state<const T extends string>(id: T) {
  // TODO: Add Payload type here that adds requirements on Event payload (Can not transition to state unless Event has XYZ fields)
  return <Context>() => {
    return new StateRef<T, Context>(id);
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

export class StateRef<T, Context = unknown> {
  name: T;
  // TODO: Hack to expose Context type
  __context: Context | undefined;
  isFinal = false;
  _region: RegionOptions | undefined;
  _regions: RegionsOptions | undefined;
  effects: Array<(...props: unknown[]) => void> = [];

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

  effect(effectFn: (options: { signal: AbortSignal; context: Context }) => void) {
    //@ts-expect-error TODO: Fix typing
    this.effects.push(effectFn);
    return this;
  }
}
