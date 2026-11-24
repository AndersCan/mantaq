import type { VizField, VizJson, VizMachine } from "../../schema.ts";
import { html } from "../dom.ts";

export interface ContextViewOptions {
  machine: VizMachine;
  /** The live context while a driver runs; unset without one. */
  live?: VizJson;
}

type Row = { name: string; value: Array<Node | string> };

function isFields(value: VizJson): value is Record<string, VizJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function code(doc: Document, text: string): HTMLElement {
  return html(doc, "code", {}, [text]);
}

function rowList(doc: Document, rows: ReadonlyArray<Row>): HTMLElement {
  return html(
    doc,
    "dl",
    {},
    rows.flatMap((row) => [
      html(doc, "dt", {}, [row.name]),
      html(doc, "dd", { "data-context-key": row.name }, row.value),
    ]),
  );
}

interface LiveRowsOptions {
  live: VizJson;
  declared: ReadonlyArray<VizField>;
}

/** The declared fields first, in their order ("not set" when absent), then any other key. */
function liveRows(doc: Document, options: LiveRowsOptions): Row[] {
  const fields = isFields(options.live) ? options.live : {};
  const names = [
    ...new Set([...options.declared.map((field) => field.name), ...Object.keys(fields)]),
  ];
  return names.map((name) => {
    const held = fields[name];
    return { name, value: held === undefined ? ["not set"] : [code(doc, JSON.stringify(held))] };
  });
}

function declaredRows(doc: Document, declared: ReadonlyArray<VizField>): Row[] {
  return declared.map((field) => ({
    name: field.name,
    value: [
      code(doc, field.type),
      field.optional ? " (optional)" : "",
      field.doc === null ? "" : html(doc, "p", { class: "doc" }, [field.doc]),
    ],
  }));
}

/** The Context tab, read only: the live context while a driver runs, else the context fields the machine declares; undefined when it would be empty. */
export function contextView(doc: Document, options: ContextViewOptions): HTMLElement | undefined {
  const declared = options.machine.context ?? [];
  const { live } = options;
  if (live !== undefined) {
    const other = !isFields(live) && live !== null;
    if (other) {
      return html(doc, "section", { class: "explore-context", "data-context": "live" }, [
        code(doc, JSON.stringify(live)),
      ]);
    }
    const rows = liveRows(doc, { live, declared });
    if (rows.length === 0) return undefined;
    return html(doc, "section", { class: "explore-context", "data-context": "live" }, [
      rowList(doc, rows),
    ]);
  }
  if (declared.length === 0) return undefined;
  return html(doc, "section", { class: "explore-context", "data-context": "declared" }, [
    html(doc, "p", { class: "muted" }, [
      "The fields the machine declares. A live run shows their values.",
    ]),
    rowList(doc, declaredRows(doc, declared)),
  ]);
}
