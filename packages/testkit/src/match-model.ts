import type { AnyActor, InternalEvent } from "@mantaq/core";
import type { ActorGraph } from "@mantaq/traversal";
import { buildGraph, INITIAL_NODE_ID, isAnyNode, parseInternalEventIds } from "@mantaq/traversal";
import * as fc from "fast-check";

type ModelInput<M> = Extract<
  M extends { send(event: infer E): void } ? E : never,
  { type: string }
>;
type ModelStateName<M extends AnyActor<unknown>> = Exclude<M["state"]["name"], "__error">;
type PayloadInput<M> = Extract<ModelInput<M>, { payload: unknown }>;

export type MatchModelOptions<M extends AnyActor<unknown>, App> = {
  /** Returns a fresh model actor. Called once per walk, plus once to read its inputs and edges. */
  model: () => M;
  /** Returns a fresh app. Called once per walk. */
  start: () => App | Promise<App>;
  /** Does each model input in the app. Awaited before the app's state is read. */
  events: {
    [K in ModelInput<M>["type"]]: (
      app: App,
      event: Extract<ModelInput<M>, { type: K }>,
    ) => void | Promise<void>;
  };
  /** Reads the app's current state as a model state name. */
  state: (app: App) => ModelStateName<M> | Promise<ModelStateName<M>>;
} & ([PayloadInput<M>] extends [never]
  ? { payloads?: never }
  : {
      /** Sample payloads per event with data; walks pick among them. */
      payloads: {
        [K in PayloadInput<M>["type"]]: ReadonlyArray<
          Extract<PayloadInput<M>, { type: K }>["payload"]
        >;
      };
    });

type EventRefLike = { type: string; create: (payload?: unknown) => InternalEvent };
type Choice = { ref: EventRefLike; payload: unknown; hasPayload: boolean };
type Row = { event: string; model: string; app: string; note: string };
type Failure = { head: string; hint: string };
type Run = { rows: Row[]; failure?: Failure; taken: Set<string> };
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
type Setup = {
  seed: number;
  stateNames: string[];
  model: () => AnyActor<unknown>;
  start: () => unknown;
  state: (app: never) => unknown;
  adapters: object;
};

const SEED = 0x1a51e;
const WALKS = 100;
const STEPS = 30;
const PREFIX = "assertMatchesModel: ";

function attempt<T>(fn: () => T | Promise<T>): Promise<Outcome<T>> {
  return Promise.resolve()
    .then(fn)
    .then(
      (value): Outcome<T> => ({ ok: true, value }),
      (error: unknown): Outcome<T> => ({ ok: false, error }),
    );
}

function isRef(value: unknown): value is EventRefLike {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}

function isAdapter(value: unknown): value is (app: unknown, event: InternalEvent) => unknown {
  return typeof value === "function";
}

function describeError(error: unknown): string {
  return String(error);
}

function eventLabel(choice: Choice): string {
  return choice.hasPayload
    ? `${choice.ref.type} ${JSON.stringify(choice.payload)}`
    : choice.ref.type;
}

function failed(what: string, after: string, error: string): Failure {
  return { head: `${what} failed ${after}: ${error}`, hint: "" };
}

function formatTable(rows: Row[]): string {
  const header = ["#", "event", "model", "app", ""];
  const cells = rows.map((row, index) => [String(index), row.event, row.model, row.app, row.note]);
  const widths = header.map((_, col) =>
    Math.max(...[header, ...cells].map((line) => (line[col] ?? "").length)),
  );
  const line = (parts: string[]) => {
    const padded = parts.map((part, col) =>
      col === 0 ? part.padStart(widths[0] ?? 0) : part.padEnd(widths[col] ?? 0),
    );
    return `  ${padded.join("  ")}`.trimEnd();
  };
  return [line(header), ...cells.map(line)].join("\n");
}

function formatFailure(failure: Failure, rows: Row[]): string {
  const table = rows.length > 0 ? `\n${formatTable(rows)}` : "";
  const hint = failure.hint === "" ? "" : `\n${failure.hint}`;
  return `${failure.head}${table}${hint}`;
}

function checkOptions(options: {
  inputs: string[];
  eventKeys: string[];
  payloads: Record<string, readonly unknown[]> | undefined;
}): string | undefined {
  const { inputs, eventKeys, payloads } = options;
  if (inputs.length === 0) return "the model has no input events to walk.";
  const list = inputs.join(", ");
  const missing = inputs.find((type) => !eventKeys.includes(type));
  if (missing !== undefined) {
    return `events has no entry for "${missing}". Add one for every model input: ${list}.`;
  }
  const extra = eventKeys.find((key) => !inputs.includes(key));
  if (extra !== undefined) return `events.${extra} is not a model input. Model inputs: ${list}.`;
  const empty = Object.entries(payloads ?? {}).find(([, samples]) => samples.length === 0);
  if (empty !== undefined) return `payloads.${empty[0]} has no samples.`;
  return undefined;
}

function buildChoices(
  refs: EventRefLike[],
  payloads: Record<string, readonly unknown[]> | undefined,
): Choice[] {
  return refs.flatMap((ref): Choice[] => {
    const list = payloads?.[ref.type];
    return list !== undefined
      ? list.map((payload: unknown) => ({ ref, payload, hasPayload: true }))
      : [{ ref, payload: undefined, hasPayload: false }];
  });
}

/** Reads the app and compares it to the model. Pushes the row and returns the failure, if any. */
async function checkStep(
  setup: Setup,
  step: { app: unknown; rows: Row[]; label: string; modelName: string; note: string },
): Promise<Failure | undefined> {
  const { app, rows, label, modelName, note } = step;
  const after = `after ${rows.length} events (seed ${setup.seed})`;
  const read = await attempt(() => Reflect.apply(setup.state, undefined, [app]));
  if (!read.ok) {
    rows.push({ event: label, model: modelName, app: "(threw)", note });
    return failed("state(app)", after, describeError(read.error));
  }
  const value = read.value;
  if (!setup.stateNames.some((name) => name === value)) {
    rows.push({ event: label, model: modelName, app: String(JSON.stringify(value)), note });
    return failed(
      "state(app)",
      after,
      `returned ${JSON.stringify(value)}, which is not a model state (${setup.stateNames.join(", ")})`,
    );
  }
  if (value === modelName) {
    rows.push({ event: label, model: modelName, app: value, note });
    return undefined;
  }
  rows.push({
    event: label,
    model: modelName,
    app: value,
    note: note === "" ? "<- differs" : `${note}, <- differs`,
  });
  return {
    head: `The app does not match the model ${after}.`,
    hint: "The app has a bug, or the model is wrong.",
  };
}

async function walkEvents(setup: Setup, app: unknown, walk: readonly Choice[], run: Run) {
  const model = setup.model();
  let handled = false;
  let modelError: unknown;
  model.on("transition", {
    fn: (info) => {
      handled = true;
      run.taken.add(`${info.from}>${info.event.type}>${info.to}`);
    },
  });
  model.on("error", {
    fn: (info) => {
      modelError = info.error;
    },
  });
  try {
    const first = await checkStep(setup, {
      app,
      rows: run.rows,
      label: "(start)",
      modelName: model.state.name,
      note: "",
    });
    if (first !== undefined) return first;
    for (const choice of walk) {
      const label = eventLabel(choice);
      const event = choice.hasPayload ? choice.ref.create(choice.payload) : choice.ref.create();
      const sent = run.rows.length;
      const before = model.state.name;
      handled = false;
      model.send(event);
      const modelName = model.state.name;
      if (modelName === "__error") {
        run.rows.push({ event: label, model: modelName, app: "-", note: "" });
        return failed(
          `The model on ${label} in ${before}`,
          `after ${sent} events (seed ${setup.seed})`,
          describeError(modelError),
        );
      }
      const adapter: unknown = Reflect.get(setup.adapters, choice.ref.type);
      const done = await attempt(() => (isAdapter(adapter) ? adapter(app, event) : undefined));
      if (!done.ok) {
        run.rows.push({ event: label, model: modelName, app: "(threw)", note: "" });
        return failed(
          `events.${choice.ref.type}`,
          `after ${sent} events (seed ${setup.seed})`,
          describeError(done.error),
        );
      }
      const note = handled ? "" : "model did not handle it";
      const failure = await checkStep(setup, { app, rows: run.rows, label, modelName, note });
      if (failure !== undefined) return failure;
    }
    return undefined;
  } finally {
    model.dispose();
  }
}

async function runWalk(setup: Setup, walk: readonly Choice[]): Promise<Run> {
  const run: Run = { rows: [], taken: new Set() };
  const started = await attempt(() => setup.start());
  if (!started.ok) {
    run.failure = failed(
      "start()",
      `after 0 events (seed ${setup.seed})`,
      describeError(started.error),
    );
    return run;
  }
  run.failure = await walkEvents(setup, started.value, walk, run);
  return run;
}

function findUncovered(graph: ActorGraph, taken: ReadonlySet<string>): string[] {
  return graph.edges
    .filter(
      (edge) =>
        edge.isInternal !== true && edge.source !== INITIAL_NODE_ID && !edge.source.includes("."),
    )
    .filter((edge) => {
      const suffix = `>${edge.label}>${edge.target}`;
      return isAnyNode(edge.source)
        ? ![...taken].some((key) => key.endsWith(suffix))
        : !taken.has(`${edge.source}${suffix}`);
    })
    .toSorted(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.label.localeCompare(b.label) ||
        a.target.localeCompare(b.target),
    )
    .map((edge) => `  ${edge.source} --${edge.label}--> ${edge.target}`);
}

export async function assertMatchesModel<M extends AnyActor<unknown>, App>(
  options: MatchModelOptions<M, App>,
): Promise<void> {
  const probe = options.model();
  const probeOptions = probe.options ?? {};
  const rawInputs: unknown = Reflect.get(probeOptions, "inputs");
  const refs = (Array.isArray(rawInputs) ? rawInputs : [])
    .filter(isRef)
    .toSorted((a, b) => a.type.localeCompare(b.type));
  const stateNames = (probeOptions.states ?? []).map((entry) => entry.name);
  const graph = buildGraph(probe, { internalIds: parseInternalEventIds(probeOptions) });
  probe.dispose();

  const optionError = checkOptions({
    payloads: options.payloads,
    inputs: refs.map((ref) => ref.type),
    eventKeys: Object.keys(options.events),
  });
  if (optionError !== undefined) throw new Error(PREFIX + optionError);

  const setup: Setup = {
    seed: SEED,
    stateNames,
    model: options.model,
    start: options.start,
    state: options.state,
    adapters: options.events,
  };
  const choices = buildChoices(refs, options.payloads);
  const taken = new Set<string>();

  const details = await fc.check(
    fc.asyncProperty(
      fc.array(fc.constantFrom(...choices), { minLength: 1, maxLength: STEPS, size: "max" }),
      async (walk) => {
        const result = await runWalk(setup, walk);
        for (const key of result.taken) taken.add(key);
        return result.failure === undefined;
      },
    ),
    { seed: SEED, numRuns: WALKS, endOnFailure: false },
  );

  if (details.failed) {
    return rethrowCounterexample(setup, details.counterexample?.[0] ?? []);
  }
  const uncovered = findUncovered(graph, taken);
  if (uncovered.length > 0) {
    throw new Error(
      `The app matched the model on ${WALKS} walks (seed ${SEED}), but no walk took these model edges:\n${uncovered.join("\n")}\nAdd payloads that lead there, or remove the edge from the model.`,
    );
  }
}

async function rethrowCounterexample(setup: Setup, walk: readonly Choice[]): Promise<never> {
  const result = await runWalk(setup, walk);
  if (result.failure === undefined) {
    throw new Error(`${PREFIX}the failing walk passed when run again; the app is not repeatable.`);
  }
  throw new Error(formatFailure(result.failure, result.rows));
}
