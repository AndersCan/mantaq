import type { VizEdge, VizExplanation, VizJson, VizMachine } from "@mantaq/viz";
import { machineExports } from "./discover.ts";
import type { MachineExport } from "./discover.ts";
import { explainRegistration } from "./handler.ts";
import { payloadSamples } from "./payloads.ts";
import { loadSource } from "./program.ts";
import type { AnalysisSource, LoadedSource } from "./program.ts";
import { Either } from "@mantaq/utils";

/** One explained registration, keyed the way runtime edges are: state + event. */
export interface HandlerSite {
  /** null = onAny. */
  state: string | null;
  event: string;
  explanation: VizExplanation;
}

function sitesOf(loaded: LoadedSource): HandlerSite[] {
  return loaded.registrations.flatMap((registration): HandlerSite[] => {
    if (registration.event === null) return [];
    const explanation = Either.from(() =>
      explainRegistration(registration, { checker: loaded.checker, root: loaded.root }),
    );
    return [
      {
        state: registration.state,
        event: registration.event,
        explanation: Either.getOrElse(explanation, {
          onLeft: (error): VizExplanation => ({
            status: "not_analyzed",
            location: null,
            reason: `analysis failed: ${String(error)}`,
            snippet: null,
          }),
        }),
      },
    ];
  });
}

/** Explain every handler registration in a file. Left = the file could not be analyzed at all. */
export function analyzeSource(source: AnalysisSource): Either<string, HandlerSite[]> {
  return Either.chain(loadSource(source), { onRight: (loaded) => Either.right(sitesOf(loaded)) });
}

/** Everything one type-check of a machine file yields. */
export interface ModuleAnalysis {
  sites: HandlerSite[];
  payloads: Record<string, VizJson[]>;
  machines: MachineExport[];
}

/** Handlers, payload samples and machine exports of a file, from one TypeScript program. */
export function analyzeModule(source: AnalysisSource): Either<string, ModuleAnalysis> {
  return Either.chain(loadSource(source), {
    onRight: (loaded) =>
      Either.right({
        sites: sitesOf(loaded),
        payloads: payloadSamples(loaded),
        machines: machineExports(loaded),
      }),
  });
}

/** Region-prefixed ids (`region.state`) match registrations by their last segment. */
function localState(id: string): string {
  return id.slice(id.lastIndexOf(".") + 1);
}

function explain(
  edge: VizEdge,
  context: { sites: ReadonlyArray<HandlerSite>; file: string },
): VizExplanation | null {
  if (edge.kind === "initial" || edge.kind === "effect") return null;
  const state = localState(edge.from);
  const site =
    context.sites.find(
      (candidate) => candidate.state === state && candidate.event === edge.event,
    ) ??
    context.sites.find((candidate) => candidate.state === null && candidate.event === edge.event);
  if (site) return site.explanation;
  return {
    status: "not_analyzed",
    location: null,
    reason: `no m.on/m.onAny registration for (${state}, ${edge.event}) found in ${context.file}`,
    snippet: null,
  };
}

/**
 * Fill `explanation` on handler-driven edges. Never adds or removes edges:
 * the runtime graph stays the source of truth. A source that cannot be
 * analyzed marks every handler edge `not_analyzed` with the reason.
 */
export function annotateMachine(machine: VizMachine, source: AnalysisSource): VizMachine {
  return annotateWith(machine, { analysis: analyzeSource(source), source });
}

/** `annotateMachine` with the analysis already done (one program for many machines). */
export function annotateWith(
  machine: VizMachine,
  context: { analysis: Either<string, ReadonlyArray<HandlerSite>>; source: AnalysisSource },
): VizMachine {
  const { analysis, source } = context;
  const file = source.file.slice(source.root.length).replace(/^[\\/]/, "");
  const edges = machine.edges.map((edge) => {
    if (Either.isLeft(analysis)) {
      const handlerDriven = edge.kind === "transition" || edge.kind === "stay";
      const explanation: VizExplanation | null = handlerDriven
        ? { status: "not_analyzed", location: null, reason: analysis[0], snippet: null }
        : null;
      return { ...edge, explanation };
    }
    return { ...edge, explanation: explain(edge, { sites: analysis[1], file }) };
  });
  return { ...machine, edges };
}
