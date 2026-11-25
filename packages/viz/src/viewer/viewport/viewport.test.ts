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

test("a new viewport is at 100% with the select tool, on the container too", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, { drawing: () => drawing });
  expect({ state: viewport.state(), seen: seen(container) }).toEqual({
    state: { scale: 1, tool: "select" },
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
      { scale: 1.5, tool: "select" },
      { scale: 2, tool: "select" },
      { scale: 1.5, tool: "select" },
      { scale: 1.5, tool: "hand" },
      { scale: 8, tool: "hand" },
      { scale: 1, tool: "hand" },
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
    state: { scale: 0.5, tool: "select" },
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
  expect(viewport.state()).toEqual({ scale: 1, tool: "select" });
});

test("panBy scrolls the container by the delta", () => {
  const { container, drawing } = containerWith("0 0 100 100");
  const viewport = viewportOf(container, { drawing: () => drawing });
  container.scrollTo({ left: 30, top: 40 });
  viewport.panBy({ x: 15, y: -10 });
  expect({ left: container.scrollLeft, top: container.scrollTop }).toEqual({ left: 45, top: 30 });
});
