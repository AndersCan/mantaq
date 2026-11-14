type Child = Node | string | null;
/** HTML element with attributes (null skips) and children. */
export declare function html<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: Record<string, string | number | null>,
  children?: ReadonlyArray<Child>,
): HTMLElementTagNameMap[K];
/** SVG element with attributes (null skips) and children. */
export declare function svg<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: Record<string, string | number | null>,
  children?: ReadonlyArray<Child>,
): SVGElementTagNameMap[K];
/** Make an element act as a button for mouse and keyboard (Enter / Space). */
export declare function activatable(element: Element, onActivate: () => void): void;
export {};
