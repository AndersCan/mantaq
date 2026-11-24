import { button, code } from "../explore.ts";
import { parseValue, valueText } from "../fill.ts";
import type { VizActorRef, VizEdge, VizField, VizJson } from "../../schema.ts";
import { arrowPayload } from "../mount/arrow-send.ts";
import type { ArrowSendContext } from "../mount/arrow-send.ts";
import { asksForPayload } from "../../moves.ts";
import { html } from "../dom.ts";
import type { PayloadEdit } from "./payloads.ts";

export interface SendFormOptions {
  from: ArrowSendContext;
  edge: VizEdge;
  actor: VizActorRef | undefined;
  /** The line that says why the guard blocks the arrow. */
  note: (text: string) => HTMLElement;
  edit: (edit: PayloadEdit) => void;
  send: () => void;
}

function fieldOf(payload: VizJson, field: VizField): VizJson | undefined {
  const isFields = typeof payload === "object" && payload !== null && !Array.isArray(payload);
  return isFields ? payload[field.name] : undefined;
}

/**
 * Where a person sends an arrow's event: a box per payload field holding what a click on the arrow
 * sends, the lock reason while the guard blocks it, and Send. A change keeps the form in place, so focus stays.
 */
export function sendForm(doc: Document, options: SendFormOptions): HTMLElement {
  const { from, edge, actor } = options;
  const asks = asksForPayload(from.machine, edge.event);
  const declared = from.machine.events.find((each) => each.id === edge.event)?.payload ?? [];
  const fields = asks ? declared : [];
  const lock = html(doc, "div", { "data-send-lock": "" });
  const whole =
    asks && fields.length === 0 ? html(doc, "p", { "data-send-payload": "" }) : undefined;
  const boxes = fields.map((field) => {
    const input = html(doc, "input", {
      type: "text",
      "data-value": field.name,
      "aria-label": field.name,
    });
    input.addEventListener("change", () => {
      options.edit({ event: edge.event, field: field.name, value: parseValue(field, input.value) });
      refill();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      input.dispatchEvent(new Event("change"));
      options.send();
    });
    return { field, input };
  });
  function refill(): void {
    const payload = arrowPayload(from, edge);
    for (const { field, input } of boxes) {
      const shown = fieldOf(payload, field);
      input.value = shown === undefined ? "" : valueText(field, shown);
    }
    whole?.replaceChildren("with ", code(doc, JSON.stringify(payload)));
    const reason = from.view.blocked.get(edge.id);
    lock.replaceChildren(...(reason === undefined ? [] : [options.note(reason)]));
  }
  refill();
  const recipient = actor !== undefined && "map" in actor ? [" to ", code(doc, actor.key)] : [];
  return html(doc, "div", { class: "send-form", "data-send-form": edge.id }, [
    lock,
    ...(whole === undefined ? [] : [whole]),
    ...boxes.map(({ field, input }) =>
      html(doc, "p", {}, [
        html(doc, "label", { class: "explore-field" }, [
          html(doc, "strong", {}, [field.name]),
          input,
        ]),
      ]),
    ),
    html(doc, "p", {}, [
      button(doc, ["Send ", code(doc, edge.event), ...recipient], {
        onClick: options.send,
        attrs: { "data-send-edge": edge.id },
      }),
    ]),
  ]);
}
