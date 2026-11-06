import { html } from "./dom.ts";

export interface Tab<Id extends string> {
  id: Id;
  label: string;
  content: HTMLElement;
}

/**
 * A tab strip over panels. Every panel stays in the DOM; inactive ones are
 * `hidden`, so a step re-rendering the panel keeps each tab's content current.
 */
export function tabs<Id extends string>(
  doc: Document,
  context: { tabs: ReadonlyArray<Tab<Id>>; active: Id; onSelect: (id: Id) => void },
): HTMLElement {
  const { active } = context;
  return html(doc, "div", { class: "tabs" }, [
    html(
      doc,
      "div",
      { class: "tab-strip", role: "tablist" },
      context.tabs.map((tab) => {
        const element = html(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": tab.id === active ? "true" : "false",
            "data-tab": tab.id,
          },
          [tab.label],
        );
        element.addEventListener("click", () => context.onSelect(tab.id));
        return element;
      }),
    ),
    ...context.tabs.map((tab) =>
      html(
        doc,
        "div",
        {
          class: "tab-panel",
          role: "tabpanel",
          "aria-label": tab.label,
          "data-tab-panel": tab.id,
          hidden: tab.id === active ? null : "",
        },
        [tab.content],
      ),
    ),
  ]);
}
