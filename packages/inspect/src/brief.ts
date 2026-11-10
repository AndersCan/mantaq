import { isAnyState, movesFrom, scopeOf } from "@mantaq/viz";
import type { VizBranch, VizEdge, VizEvent, VizMachine, VizState } from "@mantaq/viz";

interface Row {
  event: string;
  target: string;
  text: string;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function code(text: string): string {
  const value = collapse(text);
  return value.includes("`") ? `\`\` ${value} \`\`` : `\`${value}\``;
}

function list(items: string[]): string {
  const spans = items.map(code);
  const last = spans.at(-1) ?? "";
  return spans.length < 2 ? last : `${spans.slice(0, -1).join(", ")} or ${last}`;
}

function localName(id: string): string {
  return id.slice(id.lastIndexOf(".") + 1);
}

function branchesOf(edge: VizEdge): VizBranch[] {
  return edge.explanation?.status === "analyzed" ? edge.explanation.branches : [];
}

function guardOf(branches: VizBranch[]): string {
  if (branches.length === 0 || branches.some((branch) => branch.conditions.length === 0)) return "";
  const parts = branches.map((branch) => branch.conditions.map(code).join(" and "));
  return ` when ${parts.join(" or ")}`;
}

function targetsOf(edge: VizEdge): Array<{ target: string; guard: string }> {
  const branches = branchesOf(edge);
  const stayGuard = guardOf(branches.filter((branch) => branch.target.kind === "stay"));
  const hasStay = branches.some((branch) => branch.target.kind === "stay");
  const extraStay = hasStay ? [{ target: "stays", guard: stayGuard }] : [];
  if (edge.kind === "stay") return [{ target: "stays", guard: stayGuard }];
  if (edge.to !== null) {
    const to = edge.to;
    const matching = branches.filter(
      (branch) => branch.target.kind === "state" && branch.target.state === localName(to),
    );
    return [{ target: code(to), guard: guardOf(matching) }, ...extraStay];
  }
  if (edge.explanation?.status !== "analyzed") {
    return [{ target: "decided at run time", guard: "" }];
  }
  const scope = scopeOf(edge.from);
  const prefix = scope === "" ? "" : `${scope}.`;
  const found = branches.flatMap((branch) => {
    if (branch.target.kind === "stay") return [];
    if (branch.target.kind === "unresolved") {
      return [
        { target: `decided at run time (${code(branch.target.text)})`, guard: guardOf([branch]) },
      ];
    }
    const state = branch.target.state;
    const matching = branches.filter(
      (each) => each.target.kind === "state" && each.target.state === state,
    );
    return [{ target: code(`${prefix}${state}`), guard: guardOf(matching) }];
  });
  return [...found, ...extraStay];
}

function rowsOf(machine: VizMachine, state: VizState): Row[] {
  const rows = new Map<string, Row>();
  for (const move of movesFrom(machine, state.id)) {
    const edge = move.edge;
    if (edge.origin !== "declared" && edge.origin !== "probe") continue;
    for (const { target, guard } of targetsOf(edge)) {
      const key = `${edge.event}\0${target}`;
      if (rows.has(key)) continue;
      const any = isAnyState(edge.from) ? " (from any state)" : "";
      const sentBy = move.sentBy.length > 0 ? ` (sent by ${move.sentBy.map(code).join(", ")})` : "";
      const emits = [...new Set(edge.emits)];
      const sends = emits.length > 0 ? `; sends out ${emits.map(code).join(", ")}` : "";
      const doc = edge.doc === null ? "" : `: ${collapse(edge.doc)}`;
      rows.set(key, {
        event: edge.event,
        target,
        text: `- ${code(edge.event)} → ${target}${guard}${any}${sentBy}${sends}${doc}`,
      });
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      Number(left.event > right.event) - Number(left.event < right.event) ||
      Number(left.target > right.target) - Number(left.target < right.target),
  );
}

function stateBlock(machine: VizMachine, state: VizState): string[] {
  const heading = `### ${code(state.id)}${state.initial ? " (start)" : ""}${state.final ? " (final)" : ""}`;
  const blocks = [heading];
  const doc = state.doc === null ? "" : collapse(state.doc);
  if (doc !== "") blocks.push(doc);
  for (const effect of state.effects) {
    const sends = effect.sends ?? [];
    const tail = sends.length > 0 ? `, which sends ${list(sends)}` : "";
    blocks.push(`On entry runs ${code(effect.name)}${tail}.`);
  }
  if (state.final) return [...blocks, "Final: takes no events."];
  const rows = rowsOf(machine, state);
  blocks.push(rows.length > 0 ? rows.map((row) => row.text).join("\n") : "Takes no events.");
  const taken = new Set(rows.map((row) => row.event));
  const ignored = machine.events
    .filter((each) => !each.internal && !taken.has(each.id))
    .map((each) => each.id);
  if (ignored.length > 0) {
    blocks.push(`Ignores ${ignored.map(code).join(", ")}.`);
  }
  return blocks;
}

function section(machine: VizMachine, title: string, states: VizState[]): string[] {
  if (states.length === 0) return [];
  const ordered = [
    ...states.filter((each) => each.initial),
    ...states.filter((each) => !each.initial),
  ];
  return [title, ...ordered.flatMap((each) => stateBlock(machine, each))];
}

function eventLine(event: VizEvent): string {
  const fields = event.payload ?? [];
  const payload =
    fields.length > 0
      ? ` with ${fields.map((field) => code(`${field.name}${field.optional ? "?" : ""}: ${field.type}`)).join(", ")}`
      : "";
  const internal = event.internal ? " (internal)" : "";
  const doc = event.doc === null ? "" : `: ${collapse(event.doc)}`;
  return `- ${code(event.id)}${payload}${internal}${doc}`;
}

/**
 * The machine as a Markdown brief for whoever builds the feature: each state,
 * the events it takes, where each goes and when, its entry effects, and the
 * input events it ignores. Names and conditions come from the machine as written.
 * Edges seen only while fuzzing are left out.
 */
export function machineBrief(machine: VizMachine): string {
  const blocks = [`# ${machine.id}`];
  if (machine.initial !== null) blocks.push(`Starts in ${code(machine.initial)}.`);
  blocks.push(
    ...section(
      machine,
      "## States",
      machine.states.filter((each) => each.region === null),
    ),
  );
  for (const region of machine.regions) {
    const title = machine.maps.includes(region)
      ? `## Each ${code(region)} child`
      : `## Region ${code(region)}`;
    blocks.push(
      ...section(
        machine,
        title,
        machine.states.filter((each) => each.region === region),
      ),
    );
  }
  if (machine.events.length > 0) {
    blocks.push("## Events", machine.events.map(eventLine).join("\n"));
  }
  if (machine.outputs.length > 0) {
    blocks.push("## Outputs", machine.outputs.map((each) => `- ${code(each)}`).join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}
