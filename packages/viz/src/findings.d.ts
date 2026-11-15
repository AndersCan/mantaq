import type { VizMachine, VizStep } from "./schema.ts";
export type VizFindingKind =
  | "handlerError"
  | "neverSee"
  | "mustSee"
  | "unhandledSend"
  | "deadEnd"
  | "unreachableState"
  | "unhandledEvent"
  | "vagueName"
  | "undocumented";
export interface VizFinding {
  kind: VizFindingKind;
  /** State the ! mark sits on. null = about the whole machine (an event-level finding): no mark. */
  state: string | null;
  /** Event the finding is about, when there is one. */
  event: string | null;
  /** Naming notes (vagueName, undocumented): not bugs. No ! mark, not in the banner count; the gate still reports them. */
  note: boolean;
  /** Headline in the machine's own names, no trailing period: "refunded can never be reached". */
  title: string;
  /** Why it is true, in the machine's names; one or two sentences, ends with a period. */
  proof: string;
  /** What to change; one sentence, ends with a period. */
  fix: string;
  /** `${title}. ${proof} ${fix}`: the design gate's line. */
  message: string;
  /** Steps from a fresh actor that reach it. [] = the initial state. null = no known path. */
  steps: VizStep[] | null;
  /** Why there is nothing to replay. null exactly when steps has at least one step. */
  noReplay: string | null;
}
/** `a`, `a and b`, `a, b and c`; more than 6: the first 6 and the count of the rest. */
export declare function names(ids: ReadonlyArray<string>): string;
/**
 * States no edge path leads to from the initial state. Empty when an undetermined
 * edge hides the answer. A region is walked from its own start state; a region
 * whose start is not recorded counts as fully reached.
 */
export declare function unreachableStates(machine: VizMachine): string[];
/** The shortest fuzz walk that reaches state `id`; [] for the initial state, null when none is known. */
export declare function pathTo(machine: VizMachine, id: string): VizStep[] | null;
/** Every design finding of a machine, with the state it concerns and the steps that reach it. */
export declare function machineFindings(machine: VizMachine): VizFinding[];
