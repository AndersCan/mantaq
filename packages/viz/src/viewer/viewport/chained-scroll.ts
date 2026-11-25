import type { Point } from "./zoom.ts";

/** Leftover scroll under a pixel is rounding, not something to pass on. */
const SUB_PIXEL = 1;

/** Scrolls the element by `delta`, and passes what it cannot take to the ancestors that scroll and then the page, as a wheel does. */
export function scrollByChained(element: Element, delta: Point): void {
  let rest = delta;
  for (const scroller of scrollersFrom(element)) {
    if (rest.x === 0 && rest.y === 0) return;
    const before = { x: scroller.scrollLeft, y: scroller.scrollTop };
    scroller.scrollBy({ left: rest.x, top: rest.y, behavior: "instant" });
    rest = {
      x: leftover(rest.x - (scroller.scrollLeft - before.x)),
      y: leftover(rest.y - (scroller.scrollTop - before.y)),
    };
  }
}

function leftover(distance: number): number {
  return Math.abs(distance) < SUB_PIXEL ? 0 : distance;
}

/** The element, its ancestors whose overflow scrolls, then the page's scrolling element. */
function scrollersFrom(element: Element): Element[] {
  const scrollers = [element];
  const view = element.ownerDocument.defaultView;
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = view?.getComputedStyle(parent);
    const scrolls = [style?.overflowX, style?.overflowY].some(
      (overflow) => overflow === "auto" || overflow === "scroll",
    );
    if (scrolls) scrollers.push(parent);
  }
  const page = element.ownerDocument.scrollingElement;
  if (page !== null && !scrollers.includes(page)) scrollers.push(page);
  return scrollers;
}
