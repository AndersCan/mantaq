const MARGIN = 16;

/** The scrollLeft that shows `spans` (content pixels, most important first), moving the least; `view.left` when they already show. A later span joins only while all fit with margins. */
export function scrollToShow(
  view: { left: number; width: number; max: number },
  spans: ReadonlyArray<{ left: number; right: number }>,
): number {
  const first = spans[0];
  if (view.width <= 0 || first === undefined) return view.left;
  let span = first;
  for (const next of spans.slice(1)) {
    const joined = {
      left: Math.min(span.left, next.left),
      right: Math.max(span.right, next.right),
    };
    if (joined.right - joined.left + 2 * MARGIN <= view.width) span = joined;
  }
  if (span.left >= view.left && span.right <= view.left + view.width) return view.left;
  const fits = span.right - span.left + 2 * MARGIN <= view.width;
  const target =
    span.left < view.left || !fits ? span.left - MARGIN : span.right + MARGIN - view.width;
  return Math.round(Math.min(Math.max(target, 0), view.max));
}

/** Scrolls the canvas sideways (never the page) so the current states in `ids` (most important first) show. */
export function keepInView(root: HTMLElement, ids: ReadonlyArray<string>): void {
  const canvas = root.querySelector<HTMLElement>(".canvas");
  if (!canvas) return;
  const origin = canvas.getBoundingClientRect().left + canvas.clientLeft - canvas.scrollLeft;
  const spans = ids.flatMap((id) => {
    const node = canvas.querySelector(`.graph g[data-node-id="${CSS.escape(id)}"]`);
    if (!node) return [];
    const rect = node.getBoundingClientRect();
    return [{ left: rect.left - origin, right: rect.right - origin }];
  });
  const next = scrollToShow(
    {
      left: canvas.scrollLeft,
      width: canvas.clientWidth,
      max: canvas.scrollWidth - canvas.clientWidth,
    },
    spans,
  );
  if (next !== canvas.scrollLeft) canvas.scrollTo({ left: next, behavior: "instant" });
}
