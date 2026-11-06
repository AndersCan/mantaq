import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

export type Todo = { id: number; text: string; done: boolean };
type TodoContext = { nextId: number; items: Todo[] };

export const add = event("ADD")<{ text: string }>();
export const remove = event("REMOVE")<{ id: number }>();
export const move = event("MOVE")<{ id: number; by: -1 | 1 }>();
export const rename = event("RENAME")<{ id: number; text: string }>();
export const toggle = event("TOGGLE")<{ id: number }>();

export function todosActor(options?: { clock?: Clock }) {
  const ready = state("ready")();
  return Actor({
    inputs: [add, remove, move, rename, toggle],
    states: [ready],
    initial: ready,
    clock: options?.clock,
    context: {
      nextId: 4,
      items: [
        { id: 1, text: "Buy milk", done: false },
        { id: 2, text: "Write tests", done: true },
        { id: 3, text: "Ship the demo", done: false },
      ],
    } as TodoContext,
    setup: (m) => {
      m.on(ready, {
        event: add,
        handler: (e, { context }) => {
          const text = e.payload.text.trim();
          if (text === "") return {};
          const c = context.get();
          c.items.push({ id: c.nextId, text, done: false });
          c.nextId += 1;
          context.set(c);
          return {};
        },
      });
      m.on(ready, {
        event: remove,
        handler: (e, { context }) => {
          const c = context.get();
          const index = c.items.findIndex((t) => t.id === e.payload.id);
          if (index === -1) return {};
          c.items.splice(index, 1);
          context.set(c);
          return {};
        },
      });
      m.on(ready, {
        event: move,
        handler: (e, { context }) => {
          const c = context.get();
          const index = c.items.findIndex((t) => t.id === e.payload.id);
          const target = index + e.payload.by;
          if (index === -1 || target < 0 || target >= c.items.length) return {};
          const [item] = c.items.splice(index, 1);
          if (item) c.items.splice(target, 0, item);
          context.set(c);
          return {};
        },
      });
      m.on(ready, {
        event: rename,
        handler: (e, { context }) => {
          const c = context.get();
          const todo = c.items.find((t) => t.id === e.payload.id);
          if (!todo) return {};
          todo.text = e.payload.text;
          context.set(c);
          return {};
        },
      });
      m.on(ready, {
        event: toggle,
        handler: (e, { context }) => {
          const c = context.get();
          const todo = c.items.find((t) => t.id === e.payload.id);
          if (!todo) return {};
          todo.done = !todo.done;
          context.set(c);
          return {};
        },
      });
    },
  });
}

export type TodosActor = ReturnType<typeof todosActor>;
