import type { VizMachine } from "../schema.ts";
import { html } from "./dom.ts";

export function rulesSection(
  doc: Document,
  machine: VizMachine,
  stateId: string,
): HTMLElement | null {
  const rules = machine.fuzz?.expectations.filter((rule) => rule.state === stateId) ?? [];
  if (rules.length === 0) return null;
  return html(doc, "section", { class: "state-rules", "data-rules": String(rules.length) }, [
    html(doc, "h3", {}, ["Rules"]),
    html(
      doc,
      "ul",
      {},
      rules.map((rule) => {
        const verdict =
          rule.kind === "neverSee"
            ? rule.held
              ? "Held in every fuzz run."
              : "Broken: a fuzz run got here, see Findings."
            : rule.held
              ? "A fuzz run reached it."
              : "No fuzz run reached it.";
        return html(doc, "li", { "data-rule": rule.kind }, [
          rule.kind === "neverSee" ? "Never here: " : "Must reach: ",
          html(doc, "code", {}, [rule.match]),
          `. ${verdict}`,
        ]);
      }),
    ),
  ]);
}
