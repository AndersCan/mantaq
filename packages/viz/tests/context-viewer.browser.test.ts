import { describe, test, expect, afterEach } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { Actor, state, event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import "../src/components/context-viewer.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

function createActor(ctx: Record<string, unknown>): AnyActor {
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

function mountViewer(ctx: Record<string, unknown>): { el: HTMLElement; actor: AnyActor } {
  const actor = createActor(ctx);
  const el = document.createElement("mantaq-context-viewer");
  document.body.appendChild(el);
  (el as any).actor = actor;
  return { el, actor };
}

describe("ContextViewer browser", () => {
  test("custom element is registered", () => {
    expect(customElements.get("mantaq-context-viewer")).toBeDefined();
  });

  test("renders context header", () => {
    const { el } = mountViewer({ count: 42 });
    expect(el.textContent).toContain("Context");
  });

  test("renders primitive fields", () => {
    const { el } = mountViewer({ count: 42, name: "hello", active: true });

    expect(el.textContent).toContain("count");
    expect(el.textContent).toContain("42");
    expect(el.textContent).toContain("name");
    expect(el.textContent).toContain("hello");
  });

  test("shows type badges", () => {
    const { el } = mountViewer({ count: 42, name: "hello", active: true });

    const badges = el.querySelectorAll(".ctx-type");
    const texts = Array.from(badges).map((b) => b.textContent!.trim());
    expect(texts).toContain("str");
    expect(texts).toContain("num");
    expect(texts).toContain("bool");
  });

  test("expands nested object on chevron click", async () => {
    const { el } = mountViewer({ user: { name: "Alice" } });

    const chevron = el.querySelector(".ctx-chevron") as HTMLElement;
    expect(chevron).not.toBeNull();
    await userEvent.click(chevron);

    expect(el.textContent).toContain("Alice");
  });

  test("enters edit mode on value click", async () => {
    const { el } = mountViewer({ name: "hello" });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    expect(value).not.toBeNull();
    await userEvent.click(value);

    const input = el.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("hello");
  });

  test("commits string edit on Enter", async () => {
    const { el, actor } = mountViewer({ name: "hello" });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    await userEvent.click(value);

    const input = el.querySelector<HTMLInputElement>("input");
    await userEvent.fill(input!, "world");
    await userEvent.keyboard("{Enter}");

    expect((actor.context as any).name).toBe("world");
  });

  test("toggles boolean on click", async () => {
    const { el, actor } = mountViewer({ active: true });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    await userEvent.click(value);

    const toggleBtn = el.querySelector<HTMLButtonElement>(".ctx-toggle");
    expect(toggleBtn).not.toBeNull();
    await userEvent.click(toggleBtn!);

    expect((actor.context as any).active).toBe(false);
  });

  test("cancels edit on Escape", async () => {
    const { el, actor } = mountViewer({ name: "hello" });

    const value = el.querySelector(".ctx-value") as HTMLElement;
    await userEvent.click(value);

    const input = el.querySelector<HTMLInputElement>("input");
    await userEvent.fill(input!, "world");
    await userEvent.keyboard("{Escape}");

    expect((actor.context as any).name).toBe("hello");
  });

  test("shows empty state for empty context", () => {
    const { el } = mountViewer({});
    expect(el.textContent).toContain("No context fields");
  });
});
