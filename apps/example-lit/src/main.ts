import { render } from "lit-html";
import "./style.css";
import { todosActor } from "./todos.ts";
import { view } from "./view.ts";

function animate(update: () => void): void {
  if (document.startViewTransition) document.startViewTransition(update);
  else update();
}

const root = document.querySelector<HTMLElement>("#app");
if (root) render(view(todosActor(), animate), root);
