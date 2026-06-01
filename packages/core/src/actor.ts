import type { AnyStateRef } from "./state.ts"; // Assume you have your own state definitions
import type { AnyEventRef } from "./event.ts"; // Assume you have your own state definitions

/**
 * Convert A | B to A & B
 */
type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (x: infer R) => any
  ? R
  : never;

export class Actor<
  const Inputs extends AnyEventRef[],
  const Outputs extends AnyEventRef[],
  const States extends AnyStateRef[],
  const InputNames extends Inputs[number]["id"],
  const StateNames extends States[number]["name"],
  const StateContext extends UnionToIntersection<NonNullable<States[number]["__context"]>>,
> {
  state: States[number];
  context: StateContext;

  options: {
    inputs: Inputs;
    outputs: Outputs;
    states: States;
    context: StateContext;
    initial: States[number];
    // todo: | Inputs[number]["id"]
    transitions: Partial<
      Record<
        StateNames,
        Partial<{
          [Id in Inputs[number]["id"]]: (event: ById<Inputs[number], Id>) => {
            next?: States[number];
            emit?: Outputs[number][];
          };
        }>
      >
    >;
  };

  constructor(options: {
    inputs: Inputs;
    outputs: Outputs;
    states: States;
    context: StateContext;
    initial: States[number];
    // todo: Support Inputs[number]["id"] - for Events that should run regardless of state (ex: ForceKill)
    transitions: Partial<
      Record<
        StateNames,
        Partial<{
          [Id in Inputs[number]["id"]]: (event: ById<Inputs[number], Id>) => {
            next?: States[number];
            emit?: Outputs[number][];
          };
        }>
      >
    >;
  }) {
    this.options = options;
    this.state = options.initial;
    this.context = options.context;
  }

  send(event: Inputs[number]): void {
    const transition =
      this.options.transitions?.[this.state.name as StateNames]?.[event.id as InputNames];

    if (transition) {
      //@ts-expect-error event is still typed as any Input event - unsure how to fix
      const step = transition(event);
      if (step.next) {
        this.state = step.next;
        const abort = new AbortController();
        step.next.effects.forEach((fn) => {
          fn({ signal: abort.signal, context: this.context });
        });
      }
    }
  }
}

type ById<T extends { id: string }, K extends T["id"]> = Extract<T, { id: K }>;
