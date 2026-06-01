import type { AnyStateRef } from "./state.ts"; // Assume you have your own state definitions
import type { AnyEventRef } from "./event.ts"; // Assume you have your own state definitions

export class Actor<
  const Inputs extends AnyEventRef[],
  const Outputs extends AnyEventRef[],
  const S extends AnyStateRef[],
  const InputNames extends Inputs[number]["id"],
  const StateNames extends S[number]["name"],
> {
  state: S[number];

  options: {
    inputs: Inputs;
    outputs: Outputs;
    states: S;
    initial: S[number];
    // todo: | Inputs[number]["id"]
    transitions: Partial<
      Record<
        StateNames,
        Partial<
          Record<
            InputNames,
            () => {
              next?: S[number];
              emit?: Outputs[number][];
            }
          >
        >
      >
    >;
  };

  constructor(options: {
    inputs: Inputs;
    outputs: Outputs;
    states: S;
    initial: S[number];
    // todo: Support Inputs[number]["id"] - for Events that should run regardless of state (ex: ForceKill)
    transitions: Partial<
      Record<
        StateNames,
        Partial<
          Record<
            InputNames,
            () => {
              next?: S[number];
              emit?: Outputs[number][];
            }
          >
        >
      >
    >;
  }) {
    this.options = options;
    this.state = options.initial;
  }

  send(event: Inputs[number]): void {
    const transition =
      this.options.transitions?.[this.state.name as StateNames]?.[event.id as InputNames];

    if (transition) {
      const step = transition();
      this.state = step.next ?? this.state;
    }
  }
}
