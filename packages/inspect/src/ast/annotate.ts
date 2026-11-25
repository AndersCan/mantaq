import type { AnalysisSource, FileRead, LoadedSource, LoadSourceOptions } from "./program.ts";
import type { VizEdge, VizExplanation, VizField, VizJson, VizMachine, VizState } from "@mantaq/viz";
import { machineExports } from "./discover.ts";
import type { MachineExport } from "./discover.ts";
import { explainRegistration } from "./handler.ts";
import { payloadFields, payloadSamples } from "./payloads.ts";
import { loadSource } from "./program.ts";
import { Either } from "@mantaq/utils";
import { scopeOf } from "@mantaq/viz";

/** One explained registration, keyed the way runtime edges are: state + event. */
export interface HandlerSite {
  /** null = onAny. */
  state: string | null;
  /** "" when the event is only known by `eventPattern`. */
  event: string;
  /** Regex source matching the events of a template-literal event type; null = exact `event`. */
  eventPattern: string | null;
  /** JSDoc of the event the registration names. null = undocumented. */
  eventDoc: string | null;
  explanation: VizExplanation;
  /** Leading JSDoc of the registration. null = undocumented. */
  doc: string | null;
}

/** Handlers and descriptions of one source file. */
interface FileDocs {
  sites: HandlerSite[];
  stateDocs: ReadonlyMap<string, string>;
  stateGroups: ReadonlyMap<string, string>;
  eventDocs: ReadonlyMap<string, string>;
  effectDocs: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** Everything annotation reads from one source file. */
export interface SourceDocs extends FileDocs {
  eventPayloads: ReadonlyMap<string, VizField[]>;
  /** Other files of the program that register handlers (a pool from a library), by file. */
  elsewhere: Array<FileDocs & { file: string; depth: number }>;
}

function sitesOf(options: { loaded: LoadedSource; read: FileRead }): HandlerSite[] {
  const { loaded, read } = options;
  return read.registrations.flatMap((registration): HandlerSite[] => {
    if (registration.event === null && registration.eventPattern === null) return [];
    const explanation = Either.from(() =>
      explainRegistration(registration, { checker: loaded.checker, root: loaded.root }),
    );
    return [
      {
        state: registration.state,
        event: registration.event ?? "",
        eventPattern: registration.eventPattern,
        eventDoc: registration.eventDoc,
        doc: registration.doc,
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

function fileDocs(loaded: LoadedSource, read: FileRead): FileDocs {
  return {
    sites: sitesOf({ loaded, read }),
    stateDocs: read.stateDocs,
    stateGroups: read.stateGroups,
    eventDocs: read.eventDocs,
    effectDocs: read.effectDocs,
  };
}

function docsOf(loaded: LoadedSource): SourceDocs {
  return {
    ...fileDocs(loaded, loaded),
    eventPayloads: payloadFields(loaded),
    elsewhere: loaded.elsewhere.map((other) => ({
      file: other.file,
      depth: other.depth,
      ...fileDocs(loaded, other),
    })),
  };
}

/** Everything one type-check of a machine file yields. */
export interface ModuleAnalysis extends SourceDocs {
  payloads: Record<string, VizJson[]>;
  machines: MachineExport[];
}

/** Handlers, payload samples and machine exports of a file, from one TypeScript program. */
export function analyzeModule(
  source: AnalysisSource,
  options: LoadSourceOptions = {},
): Either<string, ModuleAnalysis> {
  return Either.chain(loadSource(source, options), {
    onRight: (loaded) =>
      Either.right({
        ...docsOf(loaded),
        payloads: payloadSamples(loaded),
        machines: machineExports(loaded),
      }),
  });
}

/** Region-prefixed ids (`region.state`) match registrations by their last segment. */
function localState(id: string): string {
  return id.slice(id.lastIndexOf(".") + 1);
}

function eventMatches(site: HandlerSite, event: string): boolean {
  return (
    site.event === event ||
    (site.eventPattern !== null && new RegExp(site.eventPattern).test(event))
  );
}

function siteFor(sites: ReadonlyArray<HandlerSite>, edge: VizEdge): HandlerSite | undefined {
  const state = localState(edge.from);
  return (
    sites.find((site) => site.state === state && eventMatches(site, edge.event)) ??
    sites.find((site) => site.state === null && eventMatches(site, edge.event))
  );
}

function eventDocFrom(options: { other: FileDocs; id: string }): string | null {
  const { other, id } = options;
  return (
    other.eventDocs.get(id) ??
    other.sites.find((site) => site.eventDoc !== null && eventMatches(site, id))?.eventDoc ??
    null
  );
}

/**
 * The one other file that registers (state, event), or why there is not exactly one.
 * Several files: the one nearest the machine file by imports wins, so a copied
 * draft is read instead of the original another file still imports.
 */
function elsewhereSite(
  edge: VizEdge,
  context: { docs: SourceDocs; file: string },
): { supplier: FileDocs; site: HandlerSite } | string {
  const found = context.docs.elsewhere.flatMap((other) => {
    const site = siteFor(other.sites, edge);
    return site ? [{ file: other.file, depth: other.depth, site, supplier: other }] : [];
  });
  const nearest = Math.min(...found.map((entry) => entry.depth));
  const closest = found.filter((entry) => entry.depth === nearest);
  const [first, second] = closest;
  if (first && second === undefined) return first;
  const state = localState(edge.from);
  return first
    ? `handlers for (${state}, ${edge.event}) found in more than one file: ${closest.map((entry) => entry.file).join(", ")}`
    : `no m.on/m.onAny registration for (${state}, ${edge.event}) found in ${context.file}`;
}

function explain(
  edge: VizEdge,
  context: { docs: SourceDocs; file: string },
): { explanation: VizExplanation | null; doc: string | null; supplier: FileDocs | null } {
  if (edge.kind === "initial") return { explanation: null, doc: null, supplier: null };
  if (edge.kind === "effect") {
    const docs = context.docs.effectDocs.get(localState(edge.from));
    return {
      explanation: null,
      doc: docs === undefined ? null : docs.join("\n\n"),
      supplier: null,
    };
  }
  const own = siteFor(context.docs.sites, edge);
  if (own) return { explanation: own.explanation, doc: own.doc, supplier: null };
  const other = elsewhereSite(edge, context);
  if (typeof other === "string") {
    return {
      explanation: { status: "not_analyzed", location: null, reason: other, snippet: null },
      doc: null,
      supplier: null,
    };
  }
  return { explanation: other.site.explanation, doc: other.site.doc, supplier: other.supplier };
}

/**
 * One handler can serve several states (a pool's resize loop): keep, per edge,
 * the branches that reach a state the machine declares for that from + event.
 */
function declaredBranches(options: { edge: VizEdge; edges: ReadonlyArray<VizEdge> }): VizEdge {
  const { edge, edges } = options;
  const { explanation } = edge;
  if (explanation === null || explanation.status !== "analyzed") return edge;
  const declared = new Set(
    edges
      .filter((other) => other.from === edge.from && other.event === edge.event)
      .map((other) => (other.to === null ? null : localState(other.to))),
  );
  const branches = explanation.branches.filter(
    (branch) => branch.target.kind !== "state" || declared.has(branch.target.state),
  );
  return { ...edge, explanation: { ...explanation, branches } };
}

/** A fuzz-found stay that the handler's own analyzed `stay` branch already explains. */
function explainedStay(edge: VizEdge): boolean {
  const { explanation } = edge;
  return (
    edge.origin === "fuzz" &&
    edge.kind === "stay" &&
    explanation !== null &&
    explanation.status === "analyzed" &&
    explanation.branches.some((branch) => branch.target.kind === "stay")
  );
}

/**
 * Fill `explanation` on handler-driven edges. Never adds edges; the only one
 * it drops is a fuzz stay that the handler's own `stay` branch explains. A source that cannot be
 * analyzed marks every handler edge `not_analyzed` with the reason.
 */
export function annotateMachine(machine: VizMachine, source: AnalysisSource): VizMachine {
  const analysis = Either.chain(loadSource(source), {
    onRight: (loaded) => Either.right(docsOf(loaded)),
  });
  return annotateWith(machine, { analysis, source });
}

/** The files a machine's state notes come from: its own first, then those that lent it handlers. */
interface StateNotes {
  own: FileDocs;
  lent: ReadonlyArray<FileDocs>;
  maps: ReadonlyArray<string>;
}

/** What a declaration's JSDoc says about a state, by the state's name. */
interface StateNote {
  notes: StateNotes;
  kind: "stateDocs" | "stateGroups";
}

function noteOf(name: string, options: StateNote): string | undefined {
  const { notes, kind } = options;
  const supplier = [notes.own, ...notes.lent].find((docs) => docs[kind].has(name));
  return supplier?.[kind].get(name);
}

/**
 * The state with the doc and `@group` of its declaration. A state in an actor map
 * keeps no group: the viewer folds groups of the machine's own regions only.
 */
function annotateState(state: VizState, notes: StateNotes): VizState {
  const name = localState(state.id);
  const annotated: VizState = { ...state, doc: noteOf(name, { notes, kind: "stateDocs" }) ?? null };
  const group = noteOf(name, { notes, kind: "stateGroups" });
  const scope = scopeOf(state.id);
  const inMap = notes.maps.some((map) => scope === map || scope.startsWith(`${map}.`));
  if (group !== undefined && !inMap) annotated.group = group;
  return annotated;
}

/** `annotateMachine` with the analysis already done (one program for many machines). */
export function annotateWith(
  machine: VizMachine,
  context: { analysis: Either<string, SourceDocs>; source: AnalysisSource },
): VizMachine {
  const { analysis, source } = context;
  const file = source.file.slice(source.root.length).replace(/^[\\/]/, "");
  const suppliers = new Set<FileDocs>();
  const edges = machine.edges.map((edge) => {
    if (Either.isLeft(analysis)) {
      const handlerDriven = edge.kind === "transition" || edge.kind === "stay";
      const explanation: VizExplanation | null = handlerDriven
        ? { status: "not_analyzed", location: null, reason: analysis[0], snippet: null }
        : null;
      return { ...edge, explanation, doc: null };
    }
    const { supplier, ...explained } = explain(edge, { docs: analysis[1], file });
    if (supplier !== null) suppliers.add(supplier);
    return declaredBranches({ edge: { ...edge, ...explained }, edges: machine.edges });
  });
  if (Either.isLeft(analysis)) return { ...machine, edges };
  const drawn = edges.filter((edge) => !explainedStay(edge));
  const { eventDocs, eventPayloads } = analysis[1];
  const lent = [...suppliers];
  return {
    ...machine,
    states: machine.states.map((state) =>
      annotateState(state, { own: analysis[1], lent, maps: machine.maps }),
    ),
    events: machine.events.map((event) => ({
      ...event,
      doc:
        eventDocs.get(event.id) ??
        lent.map((other) => eventDocFrom({ other, id: event.id })).find((doc) => doc !== null) ??
        null,
      payload: eventPayloads.get(event.id) ?? null,
    })),
    edges: drawn.map((edge) => {
      if (edge.kind !== "effect" || edge.doc !== null) return edge;
      const name = localState(edge.from);
      const docs = lent.find((other) => other.effectDocs.has(name))?.effectDocs.get(name);
      return { ...edge, doc: docs === undefined ? null : docs.join("\n\n") };
    }),
  };
}
