import { describe, test, expect } from "vite-plus/test";
import { Actor, state, event } from "@mantaq/core";
import "../src/components/context-viewer.ts";

function createActor(ctx: Record<string, unknown>) {
  const idle = state("idle")();
  const go = event("GO")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    states: [idle],
    initial: idle,
    context: ctx,
    setup: (m) => {
      m.on(idle, go, () => ({ state: idle }));
    },
  });
}

function mountViewer(ctx: Record<string, unknown>) {
  const actor = createActor(ctx);
  const el = document.createElement("mantaq-context-viewer");
  document.body.appendChild(el);
  (el as any).actor = actor;
  return { el, actor };
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("ContextViewer", () => {
  test("custom element is registered", () => {
    expect(customElements.get("mantaq-context-viewer")).toBeDefined();
  });

  test("renders primitive fields", () => {
    const { el } = mountViewer({ count: 42, name: "hello", active: true });

    expect(el.textContent).toContain("count");
    expect(el.textContent).toContain("42");
    expect(el.textContent).toContain("name");
    expect(el.textContent).toContain("hello");
    expect(el.textContent).toContain("active");
    expect(el.textContent).toContain("true");
  });

  test("shows type badges", () => {
    const { el } = mountViewer({ count: 42, name: "hello", active: true });

    const badges = el.querySelectorAll(".ctx-type");
    const texts = Array.from(badges).map((b) => b.textContent!.trim());
    expect(texts).toContain("str");
    expect(texts).toContain("num");
    expect(texts).toContain("bool");
  });

  test("renders nested object as collapsible", () => {
    const { el } = mountViewer({ user: { name: "Alice" } });

    expect(el.textContent).toContain("user");
    expect(el.textContent).toContain("obj");

    const chevron = el.querySelector(".ctx-chevron");
    expect(chevron).toBeDefined();
  });

  test("expands nested object on chevron click", () => {
    const { el } = mountViewer({ user: { name: "Alice" } });

    const chevron = el.querySelector(".ctx-chevron") as HTMLElement;
    click(chevron);

    expect(el.textContent).toContain("name");
    expect(el.textContent).toContain("Alice");
  });

  test("collapses expanded object on second chevron click", () => {
    const { el } = mountViewer({ user: { name: "Alice" } });

    const chevron = el.querySelector(".ctx-chevron") as HTMLElement;
    click(chevron);
    click(chevron);

    const body = el.querySelector(".ctx-body");
    expect(body?.textContent).not.toContain("Alice");
  });

  test("enters edit mode on value click", () => {
    const { el } = mountViewer({ name: "hello" });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    click(value);

    const input = el.querySelector("input") as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe("hello");
  });

  test("commits string edit on Enter", () => {
    const { el, actor } = mountViewer({ name: "hello" });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    click(value);

    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "world";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect((actor.context as any).name).toBe("world");
    expect(el.querySelector("input")).toBeNull();
  });

  test("commits number edit on checkmark click", () => {
    const { el, actor } = mountViewer({ count: 1 });

    const rows = el.querySelectorAll(".ctx-row");
    const value = rows[0]!.querySelector(".ctx-value") as HTMLElement;
    click(value);

    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "99";
    input.dispatchEvent(new Event("input"));

    const checkBtn = el.querySelector(".ctx-btn-ok") as HTMLButtonElement;
    click(checkBtn);

    expect((actor.context as any).count).toBe(99);
    expect(el.querySelector("input")).toBeNull();
  });

  test("toggles boolean on click", () => {
    const { el, actor } = mountViewer({ active: true });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    click(value);

    const toggleBtn = el.querySelector(".ctx-toggle") as HTMLButtonElement;
    click(toggleBtn);

    expect((actor.context as any).active).toBe(false);
  });

  test("cancels edit on Escape", () => {
    const { el, actor } = mountViewer({ name: "hello" });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    click(value);

    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "world";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect((actor.context as any).name).toBe("hello");
    expect(el.querySelector("input")).toBeNull();
  });

  test("dispatches context-edit event on commit", () => {
    const { el } = mountViewer({ name: "hello" });

    let eventDetail: unknown = null;
    el.addEventListener("context-edit", ((e: CustomEvent) => {
      eventDetail = e.detail;
    }) as EventListener);

    const value = el.querySelector(".ctx-value") as HTMLElement;
    click(value);

    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "world";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(eventDetail).toEqual({ path: ["name"], value: "world" });
  });

  test("shows empty state for empty context", () => {
    const { el } = mountViewer({});

    expect(el.textContent).toContain("No context fields");
  });

  test("skips functions and null values", () => {
    const { el } = mountViewer({
      name: "hello",
      fn: () => {},
      nothing: null,
    });

    expect(el.textContent).toContain("name");
    expect(el.textContent).toContain("hello");

    const rows = el.querySelectorAll(".ctx-row");
    const keys = Array.from(rows).map((r) => r.querySelector(".ctx-key")?.textContent?.trim());
    expect(keys).toContain("name");
    expect(keys).not.toContain("fn");
    expect(keys).not.toContain("nothing");
  });
});
