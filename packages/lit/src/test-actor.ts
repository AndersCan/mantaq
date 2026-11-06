import { Actor, event, state } from "@mantaq/core";

export type Todo = { id: number; text: string };
export type Ctx = { items: Todo[]; label: string };

export const rename = event("RENAME")<{ id: number; text: string }>();
export const relabel = event("RELABEL")<{ label: string }>();
export const reverse = event("REVERSE")();

export function makeActor() {
  const ready = state("ready")();
  return Actor({
    inputs: [rename, relabel, reverse],
    states: [ready],
    initial: ready,
    context: {
      items: [
        { id: 1, text: "a" },
        { id: 2, text: "b" },
        { id: 3, text: "c" },
      ],
      label: "x",
    } as Ctx,
    setup: (m) => {
      m.on(ready, {
        event: rename,
        handler: (e, { context }) => {
          const c = context.get();
          const todo = c.items.find((item) => item.id === e.payload.id);
          if (todo) todo.text = e.payload.text;
          context.set(c);
          return {};
        },
      });
      m.on(ready, {
        event: relabel,
        handler: (e, { context }) => {
          context.set({ ...context.get(), label: e.payload.label });
          return {};
        },
      });
      m.on(ready, {
        event: reverse,
        handler: (_e, { context }) => {
          const c = context.get();
          c.items.reverse();
          context.set(c);
          return {};
        },
      });
    },
  });
}
