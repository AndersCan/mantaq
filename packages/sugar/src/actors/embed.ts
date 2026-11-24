import type {
  ActorBuilder,
  AnyActor,
  AnyEventRef,
  AnyStateRef,
  Clock,
  CreatedOf,
  EffectInput,
  EventRef,
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

type ChildEventOf<Built> =
  ActorOf<Built> extends { send(event: infer Event): void } ? Event : never;

type ChildSnapshotOf<Built> = ActorOf<Built> extends { snapshot(): infer Taken } ? Taken : never;

type RefusedInputOf<
  Forward extends readonly AnyEventRef[],
  Built,
> = Forward[number] extends infer Ref extends AnyEventRef
  ? Ref extends AnyEventRef
    ? CreatedOf<Ref> extends ChildEventOf<Built>
      ? never
      : Ref["type"]
    : never
  : never;

/** A `never`-shaped field names each forwarded event the child has no input for, or whose payload the child input does not take. */
type ForwardFits<Forward extends readonly AnyEventRef[], Built> = [
  RefusedInputOf<Forward, Built>,
] extends [never]
  ? unknown
  : { readonly inputsTheChildDoesNotTake: RefusedInputOf<Forward, Built> };

/** A `never`-shaped field asks for an output whose payload takes every child snapshot. */
type SnapshotFits<Changed, Built> =
  Changed extends EventRef<string, infer Payload>
    ? [ChildSnapshotOf<Built>] extends [Payload]
      ? unknown
      : { readonly payloadMustTakeTheChildSnapshot: ChildSnapshotOf<Built> }
    : unknown;

/** An event whose `create` takes a child snapshot as its payload. */
interface SnapshotEvent {
  readonly type: string;
  create(payload: Snapshot): InternalEvent;
}

/** What `embed` puts on its effect fn as `embedded`, so tools find the child with `Reflect.get(fn, "embedded")`. */
export interface Embedded {
  readonly machine: Machine;
  /** Event type the parent receives, per final state name of the child. */
  readonly done: Readonly<Record<string, string>>;
  /** Event type the parent receives when the child enters `__error`, or a final state `done` does not name (only an untyped child can). */
  readonly error: string;
  /** Parent input types that embed sends on to the running child while the parent is in the embedding state. */
  readonly forward: readonly string[];
  /** Parent output type that carries each child snapshot, or undefined when the parent does not ask for one. */
  readonly snapshot: string | undefined;
}

interface EmbedOptions<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  Built extends Made,
  Forward extends ReadonlyArray<Inputs[number]>,
  Changed extends Outputs[number],
> {
  in: NonFinalStateRef<[...States]>;
  machine: Machine<string, object, Built> &
    ChildFits<Built, EventTypes<Inputs> | EventTypes<Internal> | EventTypes<Outputs>>;
  done: Readonly<Record<FinalNameOf<Built>, VoidEventOf<Internal>>>;
  error: VoidEventOf<Internal>;
  /** Parent inputs that go on to the running child. Each one must be an input of the child. */
  forward?: Forward & ForwardFits<Forward, Built>;
  /** A parent output that carries the child snapshot: once on entry, then on each child change. */
  snapshot?: Changed & SnapshotFits<Changed, Built>;
}

/**
 * Runs `machine` while the parent is in `in`: built on entry with the parent clock, disposed on leave.
 * A child final state sends its `done` event, a child `__error` sends `error`, child outputs go to the parent,
 * and each `forward` input the parent receives in `in` goes to the child.
 */
export function embed<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
  Built extends Made,
  const Forward extends ReadonlyArray<Inputs[number]> = readonly [],
  Changed extends Outputs[number] = never,
>(
  builder: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext, Clock>,
  options: EmbedOptions<States, Inputs, Internal, Outputs, Built, Forward, Changed>,
): void {
  const { machine } = options;
  const error: VoidEvent = options.error;
  const forward: ReadonlyArray<Inputs[number]> = options.forward ?? [];
  const snapshotEvent: SnapshotEvent | undefined = options.snapshot;
  const doneEvents: Readonly<Record<string, VoidEventOf<Internal>>> = options.done;
  const done = new Map<string, VoidEvent>(Object.entries(doneEvents));
  const sends: Array<Internal[number]> = [
    ...new Set([...Object.values(doneEvents), options.error]),
  ];
  let running: AnyActor<unknown> | undefined;

  function run(input: EffectInput<ActorContext, unknown, InternalEvent>): Promise<void> | void {
    const clock: Clock | undefined = Reflect.get(input, "clock");
    if (clock === undefined) {
      input.emit(error.create());
      return;
    }
    const child = actorOf(machine.create({ clock }));
    running = child;
    input.signal.addEventListener("abort", () => {
      running = undefined;
      child.dispose();
    });
    child.on("output", { fn: (event) => input.emit(event) });
    let phase: "running" | "ended" = "running";
    child.on("change", {
      fn: (snapshot) => {
        if (phase === "ended") return;
        if (snapshotEvent !== undefined) input.emit(snapshotEvent.create(snapshot));
        if (snapshot.done !== true) return;
        phase = "ended";
        input.emit(endEvent(snapshot, { done, error }).create());
      },
    });
    return child.settled();
  }

  const embedded: Embedded = {
    machine,
    done: Object.fromEntries([...done].map(([name, event]) => [name, event.type])),
    error: error.type,
    forward: forward.map((event) => event.type),
    snapshot: snapshotEvent?.type,
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
  for (const event of forward) {
    builder.on(options.in, { event, handler: (sent) => running?.send(sent) });
  }
}

function actorOf(built: Made): AnyActor<unknown> {
  return "actor" in built ? built.actor : built;
}

interface Endings<Event> {
  done: ReadonlyMap<string, Event>;
  error: Event;
}

/** `__error` is final and never mapped, so it reports `error`, like a final state only an untyped child can reach. */
function endEvent<Event>(snapshot: Snapshot, endings: Endings<Event>): Event {
  return endings.done.get(snapshot.path[0]) ?? endings.error;
}
