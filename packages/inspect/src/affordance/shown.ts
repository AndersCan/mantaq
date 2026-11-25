/** Attributes that change what the reader sees of a viewer; the rest (ids, roles, tab stops) do not. Both click sweeps compare these and the text. */
export const SHOWN_ATTRIBUTES = [
  "class",
  "hidden",
  "disabled",
  "aria-disabled",
  "open",
  "style",
  "transform",
  "viewBox",
  "aria-selected",
  "aria-pressed",
  "aria-expanded",
  "aria-current",
  "data-current",
];

/** States whose `selected` outline is no visible answer to a click: a diagram-only viewer has no panel to show what was selected. An arrow keeps it, as the sign that a stay arrow was sent. */
export const OUTLINE_ONLY = ".diagram-only .state";
