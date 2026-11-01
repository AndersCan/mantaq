import { isAnyState } from "./schema.ts";
import type {
  AtlasEdge,
  AtlasJourney,
  AtlasJourneyInput,
  AtlasJourneyMove,
  AtlasMachine,
  AtlasStep,
} from "./schema.ts";
import { matches } from "./fuzz/coverage.ts";
import { execute } from "./fuzz/run.ts";
import type { FuzzTarget, Observation } from "./fuzz/run.ts";
import { Either } from "@mantaq/utils";

/** A journey as written: a title for the reader plus the inputs that drive it. */
export interface JourneySpec {
  id: string;
  /** Reader-facing, e.g. "How we handle a declined card". */
  title: string;
  description?: string;
  inputs: ReadonlyArray<{ step: AtlasStep; note?: string }>;
}

/** Why a journey cannot be recorded. */
export interface JourneyIssue {
  journey: string;
  message: string;
}

/**
 * Drawn edge a handler run matches. A state's own edge beats an `onAny` one
 * (core runs the state handler first), and a known target beats `?`.
 */
function edgeOf(machine: AtlasMachine, seen: Observation): AtlasEdge | undefined {
  const rank = (edge: AtlasEdge) => (isAnyState(edge.from) ? 2 : 0) + (edge.to === null ? 1 : 0);
  return machine.edges
    .filter((edge) => edge.kind !== "initial" && edge.kind !== "effect" && matches(edge, seen))
    .sort((left, right) => rank(left) - rank(right))[0];
}

function eventOf(step: AtlasStep): string {
  return step.kind === "event" ? step.event : "";
}

function movesOf(
  machine: AtlasMachine,
  context: { inputs: ReadonlyArray<AtlasJourneyInput>; observations: Observation[]; start: string },
): AtlasJourneyMove[] {
  let current = context.start;
  return context.inputs.flatMap((input, index): AtlasJourneyMove[] => {
    const seen = context.observations.filter((each) => each.step === index);
    if (seen.length === 0) {
      return [
        {
          input: index,
          from: current,
          event: eventOf(input.step),
          to: current,
          outcome: "ignored",
          edge: null,
          effects: [],
        },
      ];
    }
    return seen.map((each) => {
      current = each.to;
      return {
        input: index,
        from: each.from,
        event: each.event,
        to: each.to,
        outcome: each.transitioned ? "transition" : "stay",
        edge: edgeOf(machine, each)?.id ?? null,
        effects: each.effects,
      };
    });
  });
}

function record(
  target: FuzzTarget,
  context: { machine: AtlasMachine; spec: JourneySpec },
): Either<JourneyIssue, AtlasJourney> {
  const { spec } = context;
  const inputs = spec.inputs.map((input) => ({ step: input.step, note: input.note ?? null }));
  const trace = execute(
    target,
    inputs.map((input) => input.step),
  );
  const failure = trace.errors[0];
  if (failure !== undefined) {
    return Either.left({
      journey: spec.id,
      message: `input ${failure.step} (${failure.event} in ${failure.from}) threw: ${failure.message}`,
    });
  }
  const start = trace.visited[0] ?? "";
  return Either.right({
    id: spec.id,
    title: spec.title,
    description: spec.description ?? null,
    start,
    inputs,
    moves: movesOf(context.machine, { inputs, observations: trace.observations, start }),
  });
}

/**
 * Replay each journey from a fresh actor and record what the real handlers
 * did, input by input. A handler that throws or a repeated id fails the whole
 * set: a journey shown to readers must be a run that actually happens.
 */
export function withJourneys(
  target: FuzzTarget,
  machine: AtlasMachine,
  specs: ReadonlyArray<JourneySpec>,
): Either<JourneyIssue[], AtlasMachine> {
  const issues: JourneyIssue[] = [];
  const journeys: AtlasJourney[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) {
      issues.push({ journey: spec.id, message: "duplicate journey id" });
      continue;
    }
    seen.add(spec.id);
    const result = record(target, { machine, spec });
    if (Either.isLeft(result)) issues.push(result[0]);
    else journeys.push(result[1]);
  }
  return issues.length > 0 ? Either.left(issues) : Either.right({ ...machine, journeys });
}
