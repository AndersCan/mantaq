import { expect, test } from "vite-plus/test";
import { add, move, remove, rename, todosActor, toggle } from "./todos.ts";

const texts = (actor: ReturnType<typeof todosActor>) => actor.context.items.map((t) => t.text);

test("starts with three seeded todos", () => {
  const actor = todosActor();
  expect(actor.context.nextId).toBe(4);
  expect(actor.context.items.map((t) => t.id)).toEqual([1, 2, 3]);
});

test("add appends a trimmed todo with the next id", () => {
  const actor = todosActor();
  actor.send(add.create({ text: "  Walk  " }));
  expect(actor.context.items.at(-1)).toEqual({ id: 4, text: "Walk", done: false });
  expect(actor.context.nextId).toBe(5);
});

test("add ignores empty and whitespace text", () => {
  const actor = todosActor();
  const changes: unknown[] = [];
  actor.on("change", { fn: (s) => changes.push(s) });
  const before = changes.length;
  actor.send(add.create({ text: "" }));
  actor.send(add.create({ text: "   " }));
  expect(actor.context.items).toHaveLength(3);
  expect(changes).toHaveLength(before);
});

test("remove deletes by id and ignores unknown ids", () => {
  const actor = todosActor();
  actor.send(remove.create({ id: 2 }));
  expect(actor.context.items.map((t) => t.id)).toEqual([1, 3]);
  actor.send(remove.create({ id: 99 }));
  expect(actor.context.items).toHaveLength(2);
});

test("move shifts an item by one and is a no-op at the edges", () => {
  const actor = todosActor();
  actor.send(move.create({ id: 1, by: 1 }));
  expect(actor.context.items.map((t) => t.id)).toEqual([2, 1, 3]);
  actor.send(move.create({ id: 3, by: -1 }));
  expect(actor.context.items.map((t) => t.id)).toEqual([2, 3, 1]);

  const changes: unknown[] = [];
  actor.on("change", { fn: (s) => changes.push(s) });
  const before = changes.length;
  actor.send(move.create({ id: 2, by: -1 }));
  actor.send(move.create({ id: 1, by: 1 }));
  actor.send(move.create({ id: 99, by: 1 }));
  expect(actor.context.items.map((t) => t.id)).toEqual([2, 3, 1]);
  expect(changes).toHaveLength(before);
});

test("rename and toggle edit one item and ignore unknown ids", () => {
  const actor = todosActor();
  actor.send(rename.create({ id: 3, text: "Done it" }));
  actor.send(toggle.create({ id: 1 }));
  expect(actor.context.items[2]?.text).toBe("Done it");
  expect(actor.context.items[0]?.done).toBe(true);
  actor.send(rename.create({ id: 99, text: "x" }));
  actor.send(toggle.create({ id: 99 }));
  expect(texts(actor)).toEqual(["Buy milk", "Write tests", "Done it"]);
});

test("rename keeps the identity of every item", () => {
  const actor = todosActor();
  const [one, two, three] = actor.snapshot().context.items;
  actor.send(rename.create({ id: 2, text: "Renamed" }));
  const after = actor.snapshot().context.items;
  expect(after[0]).toBe(one);
  expect(after[1]).toBe(two);
  expect(after[2]).toBe(three);
  expect(two?.text).toBe("Renamed");
});
