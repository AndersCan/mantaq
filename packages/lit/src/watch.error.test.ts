// @vitest-environment happy-dom
import { html, render } from "lit-html";
import { expect, test } from "vite-plus/test";
import { makeActor, relabel } from "./test-actor.ts";
import { watch } from "./watch.ts";

test("a throwing selector keeps the last value and does not block other bindings", () => {
  const actor = makeActor();
  const root = document.createElement("div");
  document.body.append(root);
  let calls = 0;
  render(
    html`<p>
        ${watch(actor, (s) => {
          calls += 1;
          if (calls === 3) throw new Error("boom");
          return s.context.label;
        })}
      </p>
      <i>${watch(actor, (s) => s.context.label)}</i>`,
    root,
  );
  actor.send(relabel.create({ label: "a" }));
  const stateBefore = actor.state;
  actor.send(relabel.create({ label: "b" }));
  expect({
    p: root.querySelector("p")?.textContent?.trim(),
    i: root.querySelector("i")?.textContent,
    sameState: actor.state === stateBefore,
  }).toEqual({ p: "a", i: "b", sameState: true });
});
