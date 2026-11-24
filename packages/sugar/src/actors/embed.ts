import type {
  ActorBuilder,
  AnyActor,
  AnyEventRef,
  AnyStateRef,
  Clock,
  EffectInput,
  InternalEvent,
  Machine,
  NonFinalStateRef,
  Snapshot,
} from "@mantaq/core";

type Made = AnyActor<unknown> | { actor: AnyActor<unknown> };

type ActorOf<Built> = Built extends { actor: infer Actor } ? Actor : Built;

type StateOf<Built> = ActorOf<Built> extends { state: infer State } ? State : never;

type FinalNameOf<Built> =
  Extract<StateOf<Built>, { isFinal: true }> extends { name: infer Name extends string }
    ? Exclude<Name, "__error">
    : never;

type OutputTypeOf<Built> =
  ActorOf<Built> extends { options: { outputs?: infer Outputs } }
    ? Outputs extends readonly AnyEventRef[]
      ? Outputs[number]["type"]
      : never
    : never;

/** An event with no payload: `create()` takes no argument. */
interface VoidEvent {
  readonly type: string;
  create(): InternalEvent;
}

type VoidEventOf<Events extends readonly AnyEventRef[]> = Extract<Events[number], VoidEvent>;

/** `never`-shaped fields name what the parent cannot take: child outputs it does not declare, parts embed would not dispose. */
type ChildFits<Built, Accepted extends string> = ([Exclude<OutputTypeOf<Built>, Accepted>] extends [
  never,
]
  ? unknown
  : { readonly outputsTheParentDoesNotDeclare: Exclude<OutputTypeOf<Built>, Accepted> }) &
  (Built extends { actor: unknown }
    ? [Exclude<keyof Built, "actor">] extends [never]
      ? unknown
      : { readonly partsEmbedDoesNotDispose: Exclude<keyof Built, "actor"> }
    : unknown);

type EventTypes<Events extends readonly AnyEventRef[]> = Events[number]["type"];

/** What `embed` puts on its effect fn as `embedded`, so tools find the child with `Reflect.get(fn, "embedded")`. */
export interface Embedded {
  readonly machine: Machine;
  /** Event type the parent receives, per final state name of the child. */
  readonly done: Readonly<Record<string, string>>;
  /** Event type the parent receives when the child enters `__error`. */
  readonly error: string;
}

interface EmbedOptions<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  Built extends Made,
> {
  in: NonFinalStateRef<[...States]>;
  machine: Machine<string, object, Built> &
    ChildFits<Built, EventTypes<Inputs> | EventTypes<Internal> | EventTypes<Outputs>>;
  done: Readonly<Record<FinalNameOf<Built>, VoidEventOf<Internal>>>;
  error: VoidEventOf<Internal>;
}

/**
 * Runs `machine` while the parent is in `in`: built on entry with the parent clock, disposed on leave.
 * A child final state sends its `done` event, a child `__error` sends `error`, child outputs go to the parent.
 */
export function embed<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
  Built extends Made,
>(
  builder: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext, Clock>,
  options: EmbedOptions<States, Inputs, Internal, Outputs, Built>,
): void {
  const { machine } = options;
  const error: VoidEvent = options.error;
  const doneEvents: Readonly<Record<string, VoidEventOf<Internal>>> = options.done;
  const done = new Map<string, VoidEvent>(Object.entries(doneEvents));
  const sends: Array<Internal[number]> = [...Object.values(doneEvents), options.error];

  function run(input: EffectInput<ActorContext, unknown, InternalEvent>): void {
    const clock: Clock | undefined = Reflect.get(input, "clock");
    if (clock === undefined) {
      input.emit(error.create());
      return;
    }
    const child = actorOf(machine.create({ clock }));
    input.signal.addEventListener("abort", () => child.dispose(), { once: true });
    child.on("output", { fn: (event) => input.emit(event) });
    child.on("change", {
      fn: (snapshot) => {
        const ended = endEvent(snapshot, { done, error });
        if (ended !== undefined) input.emit(ended.create());
      },
    });
  }

  const embedded: Embedded = {
    machine,
    done: Object.fromEntries([...done].map(([name, event]) => [name, event.type])),
    error: error.type,
  };
  /** `sends` lists the mapped events; typed as maybe-undeclared so `emit` also takes the forwarded child outputs. */
  builder.effect<NonFinalStateRef<[...States]>, ReadonlyArray<Internal[number]> | undefined>(
    options.in,
    {
      name: `embed:${machine.id}`,
      sends,
      fn: Object.assign(run, { embedded }),
    },
  );
}

function actorOf(built: Made): AnyActor<unknown> {
  return "actor" in built ? built.actor : built;
}

interface Endings<Event> {
  done: ReadonlyMap<string, Event>;
  error: Event;
}

/** A final state the parent did not map (only an untyped child can reach one) also reports `error`. */
function endEvent<Event>(snapshot: Snapshot, endings: Endings<Event>): Event | undefined {
  if (snapshot.error !== undefined) return endings.error;
  if (snapshot.done !== true) return undefined;
  return endings.done.get(snapshot.path[0] ?? "") ?? endings.error;
}
