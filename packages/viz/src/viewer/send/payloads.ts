import type { VizEvent, VizJson } from "../../schema.ts";
import { Either } from "@mantaq/utils";
import type { Values } from "../fill.ts";

/** Event id → the payload fields a person changed in that event's send form; every send of the event uses them. */
export type Payloads = Readonly<Record<string, Values>>;

export interface PayloadEdit {
  event: string;
  field: string;
  /** undefined drops the change, so the field goes back to its prefill. */
  value: VizJson | undefined;
}

export function withEdit(payloads: Payloads, edit: PayloadEdit): Payloads {
  const { [edit.event]: before = {}, ...others } = payloads;
  const { [edit.field]: _dropped, ...kept } = before;
  const fields = edit.value === undefined ? kept : { ...kept, [edit.field]: edit.value };
  if (Object.keys(fields).length === 0) return others;
  return { ...others, [edit.event]: fields };
}

function isFields(value: unknown): value is Values {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `event=<json>` per event, as kept in the address (`?payload=`). */
export function encodePayloads(payloads: Payloads): string[] {
  return Object.entries(payloads).map(([event, fields]) => `${event}=${JSON.stringify(fields)}`);
}

function parsedFields(text: string): Values | undefined {
  const parsed: unknown = Either.getRight(Either.from((): unknown => JSON.parse(text)));
  return isFields(parsed) ? parsed : undefined;
}

/** The inverse of `encodePayloads`; an entry with no event, no `=`, or JSON that is not an object is skipped. */
export function decodePayloads(encoded: ReadonlyArray<string>): Payloads {
  const payloads: Record<string, Values> = {};
  for (const entry of encoded) {
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    const fields = parsedFields(entry.slice(at + 1));
    if (fields !== undefined) payloads[entry.slice(0, at)] = fields;
  }
  return payloads;
}

/** Old `?value=name=<json>` links set a field by name for every event: each event with a field of that name gets the value. */
export function legacyPayloads(values: Values, events: ReadonlyArray<VizEvent>): Payloads {
  let payloads: Payloads = {};
  for (const event of events) {
    for (const field of event.payload ?? []) {
      const linked = values[field.name];
      if (linked !== undefined) {
        payloads = withEdit(payloads, { event: event.id, field: field.name, value: linked });
      }
    }
  }
  return payloads;
}
