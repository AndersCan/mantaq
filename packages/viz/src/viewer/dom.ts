import { isNever } from "../is-never.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

type Child = Node | string | null;

function append(parent: Element, children: ReadonlyArray<Child>): void {
  for (const child of children) {
    if (child === null) continue;
    parent.append(child);
  }
}

function setAttributes(element: Element, attrs: Record<string, string | number | null>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null) element.setAttribute(name, String(value));
  }
}

/** HTML element with attributes (null skips) and children. */
export function html<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number | null> = {},
  children: ReadonlyArray<Child> = [],
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  setAttributes(element, attrs);
  append(element, children);
  return element;
}

/** SVG element with attributes (null skips) and children. */
export function svg<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number | null> = {},
  children: ReadonlyArray<Child> = [],
): SVGElementTagNameMap[K] {
  const element = doc.createElementNS(SVG_NS, tag);
  setAttributes(element, attrs);
  append(element, children);
  return element;
}

/** Make an element act as a button for mouse and keyboard (Enter / Space). */
export function activatable(element: Element, onActivate: () => void): void {
  onButtonPress(element, { press: onActivate });
  affordance(element, "button");
}

/** How an element shows a click: as a button (pointer, tab stop, `role=button`), plain, or the current choice (plain, with `aria-current`). */
export type Affordance = "button" | "plain" | "current";

/** Shows an element as a button only where a click on it does something visible. A plain element that has focus keeps it, but leaves the tab order, and so does the current choice, which a click would only choose again. */
export function affordance(element: Element, look: Affordance): void {
  switch (look) {
    case "button":
      element.setAttribute("tabindex", "0");
      element.setAttribute("role", "button");
      element.removeAttribute("aria-current");
      return;
    case "plain":
      leaveTabOrder(element);
      element.removeAttribute("aria-current");
      return;
    case "current":
      leaveTabOrder(element);
      element.setAttribute("aria-current", "true");
      return;
    default:
      return isNever(look);
  }
}

function leaveTabOrder(element: Element): void {
  element.removeAttribute("role");
  if (element.ownerDocument.activeElement === element) element.setAttribute("tabindex", "-1");
  else element.removeAttribute("tabindex");
}

export interface ButtonPressOptions {
  press: () => void;
}

/** Calls `press` on a click, Enter or Space, but only while the element shows as a button. */
export function onButtonPress(element: Element, options: ButtonPressOptions): void {
  const { press } = options;
  function isButton(): boolean {
    return element.getAttribute("role") === "button";
  }
  element.addEventListener("click", () => {
    if (isButton()) press();
  });
  element.addEventListener("keydown", (event) => {
    if (!("key" in event) || !isButton()) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    // A held key repeats: it must not press what focus moved to after the first press.
    if ("repeat" in event && event.repeat === true) return;
    event.preventDefault();
    press();
  });
}
