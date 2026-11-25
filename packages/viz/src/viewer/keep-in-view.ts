const MARGIN = 16;

/** A stretch of content pixels along one axis. */
export interface Span {
  left: number;
  right: number;
}

/** A scroll box along one axis: its offset, the length it shows, and the largest offset. */
export interface ScrollView {
  left: number;
  width: number;
  max: number;
}

/** The scroll offset that shows `span` (content pixels), moving the least; `view.left` when it already shows; `left`/`width` are along either axis. */
export function scrollToShow(view: ScrollView, span: Span): number {
  if (view.width <= 0) return view.left;
  if (span.left >= view.left && span.right <= view.left + view.width) return view.left;
  const fits = span.right - span.left + 2 * MARGIN <= view.width;
  const target =
    span.left < view.left || !fits ? span.left - MARGIN : span.right + MARGIN - view.width;
  return Math.round(Math.min(Math.max(target, 0), view.max));
}

export interface AroundSpans {
  /** What must show. */
  node: Span;
  /** What should show too: as many of them whole as fit with `node`. */
  labels: Span[];
}

/** The span that holds them all. */
function spanOf(spans: ReadonlyArray<Span>): Span {
  let left = Infinity;
  let right = -Infinity;
  for (const span of spans) {
    left = Math.min(left, span.left);
    right = Math.max(right, span.right);
  }
  return { left, right };
}

/**
 * Like `scrollToShow` for the node and its labels when they fit together.
 * Else the offset that shows the node and the most labels whole, moving the
 * least, then centred on them all.
 */
export function scrollToShowAround(view: ScrollView, spans: AroundSpans): number {
  const { node, labels } = spans;
  const whole = spanOf([node, ...labels]);
  const fits = whole.right - whole.left + 2 * MARGIN <= view.width;
  if (view.width <= 0 || fits) return scrollToShow(view, whole);
  const low = Math.max(node.right + MARGIN - view.width, 0);
  const high = Math.min(node.left - MARGIN, view.max);
  if (low > high) return scrollToShow(view, node);
  const tries = [view.left, (whole.left + whole.right - view.width) / 2];
  for (const label of labels) tries.push(label.left - MARGIN, label.right + MARGIN - view.width);
  let best = { offset: view.left, shown: -1 };
  for (const offset of tries) {
    const kept = Math.round(Math.min(Math.max(offset, low), high));
    const shown = labels.filter((label) =>
      isShown(label, { left: kept, width: view.width }),
    ).length;
    if (shown > best.shown) best = { offset: kept, shown };
  }
  return best.offset;
}

interface Window {
  left: number;
  width: number;
}

function isShown(span: Span, window: Window): boolean {
  return span.left >= window.left && span.right <= window.left + window.width;
}

/** A box in content pixels of the canvas. */
interface Area {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface KeepInViewOptions {
  /** The drawn node to show. */
  node: string;
  /** "sendable": the node and the arrows a click sends now, as much of them as fits with the node. */
  with: "alone" | "sendable";
}

/** Scrolls the canvas, never the page, so the node shows, with its sendable arrows when asked: sideways, and up or down between the name bar and the Step panel. */
export function keepInView(root: HTMLElement, options: KeepInViewOptions): void {
  const canvas = root.querySelector<HTMLElement>(".canvas");
  if (!canvas) return;
  const node = canvas.querySelector(`.graph g[data-node-id="${CSS.escape(options.node)}"]`);
  if (!node) return;
  const own = areaOf(canvas, node);
  const labels = options.with === "sendable" ? sendableLabels(canvas) : [];
  const across: Span[] = [];
  for (const label of labels) across.push({ left: label.left, right: label.right });
  const left = scrollToShowAround(
    {
      left: canvas.scrollLeft,
      width: canvas.clientWidth,
      max: canvas.scrollWidth - canvas.clientWidth,
    },
    { node: { left: own.left, right: own.right }, labels: across },
  );
  const top = scrollTopToShow(canvas, { band: bandOf(root, canvas), node: own, labels });
  if (left === canvas.scrollLeft && top === canvas.scrollTop) return;
  canvas.scrollTo({ left, top, behavior: "instant" });
}

/** Where `element` is drawn, in content pixels of `canvas`. */
function areaOf(canvas: HTMLElement, element: Element): Area {
  const box = canvas.getBoundingClientRect();
  const originLeft = box.left + canvas.clientLeft - canvas.scrollLeft;
  const originTop = box.top + canvas.clientTop - canvas.scrollTop;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - originLeft,
    right: rect.right - originLeft,
    top: rect.top - originTop,
    bottom: rect.bottom - originTop,
  };
}

/** The label of each arrow that a click sends now: what the reader clicks. */
function sendableLabels(canvas: HTMLElement): Area[] {
  const labels: Area[] = [];
  for (const arrow of canvas.querySelectorAll('.graph g.edge.next[role="button"]')) {
    const lines = arrow.querySelectorAll(":scope > text");
    const parts: Area[] = [];
    for (const line of lines.length > 0 ? lines : [arrow]) parts.push(areaOf(canvas, line));
    const across = spanOf(parts);
    const down = spanOf(parts.map((part) => ({ left: part.top, right: part.bottom })));
    labels.push({ left: across.left, right: across.right, top: down.left, bottom: down.right });
  }
  return labels;
}

/** The part of the canvas on screen, in window pixels: below the name bar, above the Step panel, inside the window. */
interface Band {
  /** The canvas's own top edge. */
  top: number;
  start: number;
  end: number;
}

function bandOf(root: HTMLElement, canvas: HTMLElement): Band {
  const box = canvas.getBoundingClientRect();
  const top = canvas.clientTop + box.top;
  const view = root.ownerDocument.defaultView?.innerHeight ?? 0;
  const bar = root.querySelector(".viz-bar")?.getBoundingClientRect().bottom ?? 0;
  const panel = root.querySelector(".panel")?.getBoundingClientRect().top ?? view;
  const start = Math.max(top, bar, 0);
  const end = Math.min(top + canvas.clientHeight, panel, view);
  return { top, start, end };
}

interface TopOptions {
  band: Band;
  node: Area;
  labels: Area[];
}

/** The scrollTop that shows the node, and as much around it as fits (content pixels), inside the band of the canvas on screen. */
function scrollTopToShow(canvas: HTMLElement, options: TopOptions): number {
  const { band, node, labels } = options;
  const { top, start, end } = band;
  const next = scrollToShowAround(
    {
      left: canvas.scrollTop + (start - top),
      width: end - start,
      max: canvas.scrollHeight,
    },
    {
      node: { left: node.top, right: node.bottom },
      labels: labels.map((label) => ({ left: label.top, right: label.bottom })),
    },
  );
  if (next === canvas.scrollTop + (start - top)) return canvas.scrollTop;
  return Math.round(
    Math.min(Math.max(next - (start - top), 0), canvas.scrollHeight - canvas.clientHeight),
  );
}
