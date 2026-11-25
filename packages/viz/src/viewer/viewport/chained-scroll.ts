import type { Point } from "./zoom.ts";

/** A scroll container and the axes a wheel scrolls it on. */
interface Scroller {
  element: Element;
  takes: { x: boolean; y: boolean };
}

/** Scrolls the element by `delta`, and passes what it cannot take to the ancestors that scroll and then the page, on the axes a wheel scrolls each one. */
export function scrollByChained(element: Element, delta: Point): void {
  let rest = delta;
  for (const { element: scroller, takes } of scrollersFrom(element)) {
    if (rest.x === 0 && rest.y === 0) return;
    const before = { x: scroller.scrollLeft, y: scroller.scrollTop };
    const step = { x: takes.x ? rest.x : 0, y: takes.y ? rest.y : 0 };
    scroller.scrollBy({ left: step.x, top: step.y, behavior: "instant" });
    rest = {
      x: rest.x - (scroller.scrollLeft - before.x),
      y: rest.y - (scroller.scrollTop - before.y),
    };
  }
}

/** The element and its ancestors whose overflow scrolls, then the page unless `html` or `body` hides its overflow. */
function scrollersFrom(element: Element): Scroller[] {
  const view = element.ownerDocument.defaultView;
  const scrollers: Scroller[] = [];
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    const takes = { x: scrolls(style?.overflowX), y: scrolls(style?.overflowY) };
    if (takes.x || takes.y) scrollers.push({ element: current, takes });
  }
  const page = element.ownerDocument.scrollingElement;
  const known = scrollers.some((scroller) => scroller.element === page);
  if (page === null || known) return scrollers;
  const roots = [element.ownerDocument.documentElement, element.ownerDocument.body];
  const styles = roots.map((root) => view?.getComputedStyle(root));
  const takes = {
    x: !styles.some((style) => hides(style?.overflowX)),
    y: !styles.some((style) => hides(style?.overflowY)),
  };
  scrollers.push({ element: page, takes });
  return scrollers;
}

function scrolls(overflow: string | undefined): boolean {
  return overflow === "auto" || overflow === "scroll";
}

function hides(overflow: string | undefined): boolean {
  return overflow === "hidden" || overflow === "clip";
}
