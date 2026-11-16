const MARGIN = 16;

/** The scrollLeft that shows `span` (content pixels), moving the least; `view.left` when it already shows. */
export function scrollToShow(
  view: { left: number; width: number; max: number },
  span: { left: number; right: number },
): number {
  if (view.width <= 0) return view.left;
  if (span.left >= view.left && span.right <= view.left + view.width) return view.left;
  const fits = span.right - span.left + 2 * MARGIN <= view.width;
  const target =
    span.left < view.left || !fits ? span.left - MARGIN : span.right + MARGIN - view.width;
  return Math.round(Math.min(Math.max(target, 0), view.max));
}

/** Scrolls the canvas sideways (never the page) so the machine's current state shows. */
export function keepInView(root: HTMLElement, current: string | undefined): void {
  const canvas = root.querySelector<HTMLElement>(".canvas");
  if (!canvas || current === undefined) return;
  const node = canvas.querySelector(`.graph g[data-node-id="${CSS.escape(current)}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const origin = canvas.getBoundingClientRect().left + canvas.clientLeft - canvas.scrollLeft;
  const next = scrollToShow(
    {
      left: canvas.scrollLeft,
      width: canvas.clientWidth,
      max: canvas.scrollWidth - canvas.clientWidth,
    },
    { left: rect.left - origin, right: rect.right - origin },
  );
  if (next !== canvas.scrollLeft) canvas.scrollTo({ left: next, behavior: "instant" });
}
