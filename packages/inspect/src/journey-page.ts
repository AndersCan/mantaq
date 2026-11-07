/**
 * "Save this walk as a journey" on the live page: under the notes, a name box
 * that sends the steps taken so far to the dev server's notes endpoint, for
 * the user's agent to turn into a test. Hidden when that endpoint does not answer.
 */
import type { VizDriver, VizLiveState } from "@mantaq/viz";
import { MAX_NOTE_LENGTH, NOTES_VERSION } from "./notes.ts";
import { errorText, post } from "./notes-page.ts";

/** The driver unchanged, plus the last state it returned: the walk to save. */
export function trackWalk(driver: VizDriver): {
  driver: VizDriver;
  current(): VizLiveState | undefined;
} {
  let latest: VizLiveState | undefined;
  const keep = (state: VizLiveState): VizLiveState => {
    latest = state;
    return state;
  };
  return {
    driver: {
      reset: () => keep(driver.reset()),
      step: (step) => keep(driver.step(step)),
      ...(driver.listen === undefined
        ? {}
        : { listen: (onChange) => driver.listen?.((state) => onChange(keep(state))) }),
    },
    current: () => latest,
  };
}

type Phase = "loading" | "unavailable" | "ready" | { refused: string };

async function probe(options: { url: string; machine: string }): Promise<Phase> {
  const response = await fetch(
    `${options.url}?machine=${encodeURIComponent(options.machine)}`,
  ).catch(() => undefined);
  if (response === undefined) return "unavailable";
  if (response.status === 409) return { refused: await errorText(response) };
  return response.ok ? "ready" : "unavailable";
}

export function journeyFooter(
  doc: Document,
  context: { url: string; machine: string; walk: () => VizLiveState | undefined },
): { section: HTMLElement; update(): void } {
  const section = doc.createElement("section");
  section.className = "journey";
  section.hidden = true;
  let phase: Phase = "loading";
  let draft = "";
  let saving = false;
  let status = "";

  const heading = doc.createElement("h3");
  heading.textContent = "Save this walk as a journey";
  const hint = doc.createElement("p");
  hint.className = "hint";
  hint.dataset["walk"] = "";
  const form = doc.createElement("form");
  const label = doc.createElement("label");
  label.textContent = "Journey name";
  const field = doc.createElement("input");
  field.type = "text";
  field.maxLength = MAX_NOTE_LENGTH;
  field.placeholder = "e.g. Nils picks 1 hour and the link runs out";
  label.append(field);
  const button = doc.createElement("button");
  button.type = "submit";
  form.append(label, button);
  const line = doc.createElement("p");
  line.className = "journey-status";
  line.setAttribute("role", "status");
  section.append(heading, hint, form, line);

  const update = () => {
    section.hidden = phase === "loading" || phase === "unavailable";
    if (typeof phase === "object") {
      section.replaceChildren(line);
      line.textContent = phase.refused;
      return;
    }
    const walk = context.walk();
    const count = walk?.steps.length ?? 0;
    hint.textContent =
      walk === undefined || count === 0
        ? "Walk the machine first: send an event or advance the clock."
        : `${count} ${count === 1 ? "step" : "steps"}, ends in ${walk.state}.`;
    field.readOnly = saving;
    button.textContent = saving ? "Saving..." : "Save journey";
    button.disabled = saving || count === 0 || draft.trim() === "";
    line.textContent = status;
  };

  field.addEventListener("input", () => {
    draft = field.value;
    update();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const walk = context.walk();
    if (saving || walk === undefined || walk.steps.length === 0 || draft.trim() === "") return;
    void save(walk);
  });

  const save = async (walk: VizLiveState) => {
    saving = true;
    status = "";
    update();
    const reason = await post(
      context.url,
      JSON.stringify({
        version: NOTES_VERSION,
        machine: context.machine,
        target: { kind: "walk" },
        note: draft,
        end: walk.state,
        steps: walk.steps,
      }),
    );
    saving = false;
    if (typeof reason === "string") {
      status = `Could not save this journey: ${reason}. Your name is still here.`;
    } else {
      draft = "";
      field.value = "";
      status = "Journey saved. Ask your agent to apply the viz notes.";
    }
    update();
  };

  void probe(context).then((next) => {
    phase = next;
    update();
  });
  update();
  return { section, update };
}
