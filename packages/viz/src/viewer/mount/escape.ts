/** Each viewer root's latest Escape handler: a viewer drawn again on the same root replaces it. */
const handlers = new WeakMap<HTMLElement, () => boolean>();

export interface EscapeOptions {
  /** Closes an open Details, else goes back one level; false when there was nothing to do. */
  escape: () => boolean;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** True on a page where nothing has focus and `root` is the one viewer that shows a path, as after a `?focus=` link opens. */
function ownsUnfocusedEscape(root: HTMLElement): boolean {
  const doc = root.ownerDocument;
  const active = doc.activeElement;
  if (active !== doc.body && active !== null) return false;
  const [path, other] = doc.querySelectorAll(".viz .focus-path");
  return path !== undefined && other === undefined && root.contains(path);
}

function answer(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (handlers.get(root)?.() === true) event.preventDefault();
}

/**
 * Escape anywhere in the viewer calls its handler, except in a text field.
 * With nothing focused, it calls it for the one viewer on the page that shows
 * a path. Listens once per root.
 */
export function listenEscape(root: HTMLElement, options: EscapeOptions): void {
  const listening = handlers.has(root);
  handlers.set(root, options.escape);
  if (listening) return;
  root.addEventListener("keydown", (event) => {
    if (!isTyping(event.target)) answer(root, event);
  });
  root.ownerDocument.addEventListener("keydown", (event) => {
    if (ownsUnfocusedEscape(root)) answer(root, event);
  });
}
