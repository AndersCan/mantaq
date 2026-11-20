const MARGIN = 16;

/** The scroll offset that shows `span` (content pixels), moving the least; `view.left` when it already shows; `left`/`width` are along either axis. */
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

/** Scrolls the canvas, never the page, so the state `id` shows: sideways, and up or down between the name bar and the Step panel. */
export function keepInView(root: HTMLElement, id: string): void {
  const canvas = root.querySelector<HTMLElement>(".canvas");
  if (!canvas) return;
  const node = canvas.querySelector(`.graph g[data-node-id="${CSS.escape(id)}"]`);
  if (!node) return;
  const box = canvas.getBoundingClientRect();
  const originLeft = box.left + canvas.clientLeft - canvas.scrollLeft;
  const originTop = box.top + canvas.clientTop - canvas.scrollTop;
  const rect = node.getBoundingClientRect();
  const left = scrollToShow(
    {
      left: canvas.scrollLeft,
      width: canvas.clientWidth,
      max: canvas.scrollWidth - canvas.clientWidth,
    },
    { left: rect.left - originLeft, right: rect.right - originLeft },
  );
  const top = scrollTopToShow(root, canvas, {
    top: rect.top - originTop,
    bottom: rect.bottom - originTop,
  });
  if (left === canvas.scrollLeft && top === canvas.scrollTop) return;
  canvas.scrollTo({ left, top, behavior: "instant" });
}

/** The scrollTop that shows `span` (content pixels) inside the part of the canvas between the name bar and the Step panel. */
function scrollTopToShow(
  root: HTMLElement,
  canvas: HTMLElement,
  span: { top: number; bottom: number },
): number {
  const box = canvas.getBoundingClientRect();
  const top = canvas.clientTop + box.top;
  const view = root.ownerDocument.defaultView?.innerHeight ?? 0;
  const bar = root.querySelector(".viz-bar")?.getBoundingClientRect().bottom ?? 0;
  const panel = root.querySelector(".panel")?.getBoundingClientRect().top ?? view;
  const from = Math.max(top, bar, 0);
  const to = Math.min(top + canvas.clientHeight, panel, view);
  const next = scrollToShow(
    {
      left: canvas.scrollTop + (from - top),
      width: to - from,
      max: canvas.scrollHeight,
    },
    { left: span.top, right: span.bottom },
  );
  if (next === canvas.scrollTop + (from - top)) return canvas.scrollTop;
  return Math.round(
    Math.min(Math.max(next - (from - top), 0), canvas.scrollHeight - canvas.clientHeight),
  );
}
