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
  element.setAttribute("tabindex", "0");
  element.setAttribute("role", "button");
  element.addEventListener("click", onActivate);
  element.addEventListener("keydown", (event) => {
    if (!("key" in event)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate();
  });
}
