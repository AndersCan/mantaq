import { machineFindings } from "@mantaq/viz";
import type { VizFinding, VizMachine, VizStep } from "@mantaq/viz";
export { unreachableStates } from "@mantaq/viz";
import { inspect, lostRunName, missingPayloadBlock } from "./inspect.ts";
import type { InspectTarget } from "./inspect.ts";
import type { LostMessage } from "./fuzz/fuzz.ts";

/** Design errors of an inspected machine, one line each. Unreached edges and routing warnings are not errors. */
export function designErrors(machine: VizMachine): string[] {
  return machineFindings(machine).map((finding) => finding.message);
}

function stepText(step: VizStep): string {
  if (step.kind === "advance") return `advance ${step.ms}ms`;
  return step.payload === null ? step.event : `${step.event} ${JSON.stringify(step.payload)}`;
}

function linesOf(findings: ReadonlyArray<VizFinding>): string[] {
  return findings.flatMap((finding) => {
    const line = `  - ${finding.message}`;
    if (finding.steps === null || finding.steps.length === 0) return [line];
    return [line, `    after: ${finding.steps.map(stepText).join(" → ")}`];
  });
}

/** One line per finding, plus the events that lead there for fuzz-found ones. */
export function findingLines(machine: VizMachine): string[] {
  return linesOf(machineFindings(machine));
}

function lostLines(id: string, lost: ReadonlyArray<LostMessage>): string[] {
  return lost.flatMap(({ sender, receiver, event, steps }) => [
    `  - ${sender} sends ${event} to ${receiver}, which never handles it. No state of ${receiver} has a handler for ${event}, so the message is lost. Handle ${event} in a state of ${receiver}, or stop sending it.`,
    `    after: ${steps.map(stepText).join(" → ")}`,
    `    on the board: ?${new URLSearchParams({ machine: id, run: lostRunName({ sender, event, receiver }) })}`,
  ]);
}

/**
 * Call from a test: throws when fuzzing finds a handler or effect that throws,
 * an effect sends an event its state does not handle, a declared state has
 * no path from the initial state, or a declared event has no state that handles it, or a message one machine returned from the factory sends another that handles it in none of its states. With `source`, it also throws on a state or
 * event whose name is only generic words (ok, loading, done...) or that has no
 * doc comment, and on a handler or a state's effects with no doc comment. Runs are seeded, so the result is stable.
 */
export function expectNoDesignErrors(target: InspectTarget): void {
  const { machine, missingPayloads, lostMessages } = inspect(target);
  const block = missingPayloadBlock(machine.id, missingPayloads);
  const lostEvents = new Set(lostMessages.map((lost) => lost.event));
  const findings = machineFindings(machine).filter(
    (finding) => !(finding.kind === "unhandledEvent" && lostEvents.has(finding.event ?? "")),
  );
  const count = lostMessages.length + findings.length;
  if (count === 0 && block === "") return;
  if (count === 0) throw new Error(block);
  const lines = [...lostLines(machine.id, lostMessages), ...linesOf(findings)];
  const found = `${machine.id} has ${count} design error${count === 1 ? "" : "s"}:\n${lines.join("\n")}`;
  throw new Error(block === "" ? found : `${block}\n\n${found}`);
}
