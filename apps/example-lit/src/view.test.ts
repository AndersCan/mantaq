// @vitest-environment happy-dom
import { render } from "lit-html";
import { expect, test } from "vite-plus/test";
import { add, move, remove, rename, todosActor, toggle } from "./todos.ts";
import { view } from "./view.ts";

const mount = () => {
  const actor = todosActor();
  const container = document.createElement("div");
  document.body.append(container);
  render(view(actor), container);
  return { actor, container };
};

const rows = (root: Element) => [...root.querySelectorAll("li")];

const observe = (root: Node) => {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return (type: string) => {
    records.push(...observer.takeRecords());
    return records.filter((r) => r.type === type).length;
  };
};

test("renders the three seeded rows", () => {
  const { container } = mount();
  expect(rows(container).map((li) => li.dataset["id"])).toEqual(["1", "2", "3"]);
  expect(container.querySelector("p")).toBeNull();
  expect(rows(container)[0]?.getAttribute("style")).toContain("view-transition-name: todo-1");
});

test("add creates exactly one new li and keeps the others", () => {
  const { actor, container } = mount();
  const before = rows(container);
  actor.send(add.create({ text: "Walk" }));
  const after = rows(container);
  expect(after).toHaveLength(4);
  expect(after.slice(0, 3).every((li, i) => li === before[i])).toBe(true);
  expect(before).not.toContain(after[3]);
});

test("remove keeps the remaining li elements", () => {
  const { actor, container } = mount();
  const [a, , c] = rows(container);
  actor.send(remove.create({ id: 2 }));
  const after = rows(container);
  expect(after).toHaveLength(2);
  expect(after[0]).toBe(a);
  expect(after[1]).toBe(c);
});

test("move reorders the same elements without touching text", () => {
  const { actor, container } = mount();
  const [a, b, c] = rows(container);
  const count = observe(container);
  actor.send(move.create({ id: 1, by: 1 }));
  const after = rows(container);
  expect(after[0]).toBe(b);
  expect(after[1]).toBe(a);
  expect(after[2]).toBe(c);
  expect(count("characterData")).toBe(0);
});

test("rename writes exactly one text change and adds or removes no nodes", () => {
  const { actor, container } = mount();
  const before = rows(container);
  const count = observe(container);
  actor.send(rename.create({ id: 2, text: "Renamed" }));
  expect(count("characterData")).toBe(1);
  expect(count("childList")).toBe(0);
  expect(rows(container).every((li, i) => li === before[i])).toBe(true);
  const input = rows(container)[1]?.querySelector<HTMLInputElement>(".rename");
  expect(input?.value).toBe("Renamed");
  expect(rows(container)[1]?.querySelector(".text")?.textContent).toBe("Renamed");
});

test("toggle flips the checkbox without new elements", () => {
  const { actor, container } = mount();
  const before = rows(container);
  const box = before[0]?.querySelector<HTMLInputElement>("input[type=checkbox]");
  expect(box?.checked).toBe(false);
  actor.send(toggle.create({ id: 1 }));
  expect(box?.checked).toBe(true);
  expect(rows(container).every((li, i) => li === before[i])).toBe(true);
});

test("empty list shows the empty state", () => {
  const { actor, container } = mount();
  for (const id of [1, 2, 3]) actor.send(remove.create({ id }));
  expect(rows(container)).toHaveLength(0);
  expect(container.querySelector("p")?.textContent).toBe("No todos yet");
  actor.send(add.create({ text: "again" }));
  expect(container.querySelector("p")).toBeNull();
});
