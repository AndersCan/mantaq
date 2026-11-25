// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import { viewportOf } from "./viewport.ts";
import type { ViewportState } from "./viewport.ts";

function containerWith(viewBox: string | undefined): { container: HTMLElement; drawing: Element } {
  const container = document.createElement("div");
  container.style.overflowX = "auto";
  container.style.overflowY = "auto";
  const drawing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (viewBox !== undefined) drawing.setAttribute("viewBox", viewBox);
  container.append(drawing);
  document.body.replaceChildren(container);
  return { container, drawing };
}

function seen(container: HTMLElement): { zoom: string; tool: string | undefined } {
  return { zoom: container.style.getPropertyValue("--viz-zoom"), tool: container.dataset["tool"] };
}

function marks(container: HTMLElement): { sizing: string | undefined; pan: string | undefined } {
  return { sizing: container.dataset["sizing"], pan: container.dataset["pan"] };
}

test("a new viewport is at 100% with the select tool, on the container too", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, { drawing: () => drawing });
  expect({ state: viewport.state(), seen: seen(container) }).toEqual({
    state: { scale: 1, tool: "select", sizing: "chosen", pan: "none" },
    seen: { zoom: "1", tool: "select" },
  });
});

test("each zoom and tool change sets the container and tells the subscribers once", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, { drawing: () => drawing });
  const told: ViewportState[] = [];
  viewport.subscribe((state) => told.push(state));
  viewport.zoomIn();
  viewport.zoomIn();
  viewport.zoomOut();
  viewport.setTool("hand");
  viewport.setTool("hand");
  viewport.zoomAt({ x: 0, y: 0 }, { scale: 20 });
  viewport.zoomAt({ x: 0, y: 0 }, { scale: 8 });
  viewport.actualSize();
  viewport.actualSize();
  expect({ told, seen: seen(container) }).toEqual({
    told: [
      { scale: 1.5, tool: "select", sizing: "chosen", pan: "none" },
      { scale: 2, tool: "select", sizing: "chosen", pan: "none" },
      { scale: 1.5, tool: "select", sizing: "chosen", pan: "none" },
      { scale: 1.5, tool: "hand", sizing: "chosen", pan: "none" },
      { scale: 8, tool: "hand", sizing: "chosen", pan: "none" },
      { scale: 1, tool: "hand", sizing: "chosen", pan: "none" },
    ],
    seen: { zoom: "1", tool: "hand" },
  });
});

test("a subscriber that stopped hears nothing more", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, { drawing: () => drawing });
  const told: number[] = [];
  const stop = viewport.subscribe((state) => told.push(state.scale));
  viewport.zoomIn();
  stop();
  viewport.zoomIn();
  expect(told).toEqual([1.5]);
});

test("fit scales the drawing's viewBox into the fit box", () => {
  const { container, drawing } = containerWith("0 0 1000 500");
  const viewport = viewportOf(container, {
    drawing: () => drawing,
    fitBox: () => ({ width: 500, height: 500 }),
  });
  viewport.fit();
  expect({ state: viewport.state(), seen: seen(container) }).toEqual({
    state: { scale: 0.5, tool: "select", sizing: "chosen", pan: "none" },
    seen: { zoom: "0.5", tool: "select" },
  });
});

test("fit leaves the scale when there is no drawing to measure", () => {
  const { container } = containerWith(undefined);
  const viewport = viewportOf(container, {
    drawing: () => undefined,
    fitBox: () => ({ width: 500, height: 500 }),
  });
  viewport.fit();
  expect(viewport.state()).toEqual({ scale: 1, tool: "select", sizing: "chosen", pan: "none" });
});

test("panBy scrolls the container by the delta", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, { drawing: () => drawing });
  container.scrollTo({ left: 30, top: 40 });
  viewport.panBy({ x: 15, y: -10 });
  expect({ left: container.scrollLeft, top: container.scrollTop }).toEqual({ left: 45, top: 30 });
});

test("a viewport takes over the held scale, tool and sizing, and a drag state comes and goes on the container", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, {
    drawing: () => drawing,
    initial: { scale: 2, tool: "hand", sizing: "chosen" },
  });
  viewport.setPan("held");
  const held = marks(container);
  viewport.setPan("dragging");
  const dragging = marks(container);
  viewport.setPan("none");
  expect({
    state: viewport.state(),
    seen: seen(container),
    held,
    dragging,
    after: marks(container),
  }).toEqual({
    state: { scale: 2, tool: "hand", sizing: "chosen", pan: "none" },
    seen: { zoom: "2", tool: "hand" },
    held: { sizing: "chosen", pan: "held" },
    dragging: { sizing: "chosen", pan: "dragging" },
    after: { sizing: "chosen", pan: undefined },
  });
});

test("a zoom leaves the fitted sizing for a chosen one", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, {
    drawing: () => drawing,
    initial: { scale: 1, tool: "select", sizing: "fitted" },
  });
  const fitted = marks(container);
  viewport.zoomIn();
  expect({ fitted, chosen: marks(container), state: viewport.state() }).toEqual({
    fitted: { sizing: "fitted", pan: undefined },
    chosen: { sizing: "chosen", pan: undefined },
    state: { scale: 1.5, tool: "select", sizing: "chosen", pan: "none" },
  });
});
