/** Each viewer root's latest Escape handler: a viewer drawn again on the same root replaces it. */
const handlers = new WeakMap<HTMLElement, () => boolean>();

/** The viewer that takes Escape on a page where nothing has focus: the one last touched, or the one a link opened. */
const owners = new WeakMap<Document, HTMLElement>();

export interface EscapeOptions {
  /** Closes an open Details, else goes back one level; false when there was nothing to do. */
  escape: () => boolean;
  /** "claim": a link opened this viewer on a path, so it takes Escape until another viewer is touched. */
  opened: "claim" | "plain";
}

/** True for a key meant for something else: a text field, or the host's own screen in the Screen tab. */
function isElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const typing =
    target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  return typing || target.closest('[data-tab-panel="screen"]') !== null;
}

/** True for a key pressed while nothing had focus. A field that drops focus on Escape, such as a site search, still had it. */
function pressedUnfocused(event: KeyboardEvent): boolean {
  const { target } = event;
  if (!(target instanceof Element)) return false;
  const doc = target.ownerDocument;
  return target === doc.body || target === doc.documentElement;
}

/** True when `root` is the viewer that owns Escape on a page where nothing has focus. */
function ownsUnfocusedEscape(root: HTMLElement): boolean {
  return root.isConnected && owners.get(root.ownerDocument) === root;
}

function answer(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (handlers.get(root)?.() === true) event.preventDefault();
}

/**
 * Escape anywhere in the viewer calls its handler, except in a text field or
 * the Screen tab.
 * With nothing focused, as after a click on text or a link opening the page,
 * it calls the handler of the viewer last touched, or of the one a link opened.
 * Listens once per root.
 */
export function listenEscape(root: HTMLElement, options: EscapeOptions): void {
  const doc = root.ownerDocument;
  const listening = handlers.has(root);
  handlers.set(root, options.escape);
  const owner = owners.get(doc);
  const free = owner === undefined || !owner.isConnected;
  if (options.opened === "claim" && free) owners.set(doc, root);
  if (listening) return;
  function claim(): void {
    owners.set(doc, root);
  }
  root.addEventListener("pointerdown", claim);
  root.addEventListener("focusin", claim);
  root.addEventListener("keydown", (event) => {
    if (!isElsewhere(event.target)) answer(root, event);
  });
  doc.addEventListener("keydown", (event) => {
    if (pressedUnfocused(event) && ownsUnfocusedEscape(root)) answer(root, event);
  });
}
