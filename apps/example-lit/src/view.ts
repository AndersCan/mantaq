import { watch } from "@mantaq/lit";
import { html, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { add, move, remove, rename, toggle } from "./todos.ts";
import type { Todo, TodosActor } from "./todos.ts";

type Animate = (update: () => void) => void;

const direct: Animate = (update) => update();

export function view(actor: TodosActor, animate: Animate = direct) {
  const row = (t: Todo) =>
    html`<li data-id=${t.id} style="view-transition-name: todo-${t.id}">
      <input
        type="checkbox"
        aria-label="Done"
        .checked=${t.done}
        @change=${() => animate(() => actor.send(toggle.create({ id: t.id })))}
      />
      <span class="text">${t.text}</span>
      <input
        class="rename"
        aria-label="Todo text"
        .value=${t.text}
        @change=${(e: Event) => {
          const text = (e.target as HTMLInputElement).value;
          animate(() => actor.send(rename.create({ id: t.id, text })));
        }}
      />
      <button @click=${() => animate(() => actor.send(move.create({ id: t.id, by: -1 })))}>
        up
      </button>
      <button @click=${() => animate(() => actor.send(move.create({ id: t.id, by: 1 })))}>
        down
      </button>
      <button @click=${() => animate(() => actor.send(remove.create({ id: t.id })))}>remove</button>
    </li>`;

  const addFromForm = (e: SubmitEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem("text") as HTMLInputElement;
    const text = input.value;
    input.value = "";
    animate(() => actor.send(add.create({ text })));
  };

  return html`<h1>Todos</h1>
    <form @submit=${addFromForm}>
      <input name="text" aria-label="New todo" placeholder="What needs doing?" />
      <button type="submit">Add</button>
    </form>
    ${watch(actor, (s) => (s.context.items.length === 0 ? html`<p>No todos yet</p>` : nothing))}
    <ul>
      ${watch(actor, (s) =>
        repeat(
          s.context.items,
          (t) => t.id,
          (t) => row(t),
        ),
      )}
    </ul>`;
}
