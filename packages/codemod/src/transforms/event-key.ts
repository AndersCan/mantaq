import ts from "typescript";
import { builderOptions, descendants, property } from "../edits.ts";
import type { Edit, Transform } from "../edits.ts";

/** `m.on(s, { eventRef: E })` -> `m.on(s, { event: E })`. Shorthand keeps its binding. */
export const eventKey: Transform = {
  name: "event-key",
  edits(file, checker) {
    const edits: Edit[] = [];
    for (const node of descendants(file)) {
      const options = builderOptions(node, checker);
      const element = options && property(options, "eventRef");
      if (element === undefined || element.name === undefined) continue;
      const text = ts.isShorthandPropertyAssignment(element) ? "event: eventRef" : "event";
      edits.push({ start: element.name.getStart(file), end: element.name.end, text });
    }
    return edits;
  },
};
