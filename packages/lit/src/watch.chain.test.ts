// @vitest-environment happy-dom
import { html, render } from "lit-html";
import { expect, test } from "vite-plus/test";
import { makeActor, relabel } from "./test-actor.ts";
import { watch } from "./watch.ts";

const subscriptionCounter = (actor: ReturnType<typeof makeActor>) => {
  const spy = { active: 0 };
  return {
    spy,
    wrapped: {
      snapshot: () => actor.snapshot(),
      on: (event: "change", options: Parameters<typeof actor.on<"change">>[1]) => {
        spy.active += 1;
        const off = actor.on(event, options);
        return () => {
          spy.active -= 1;
          off();
        };
      },
    },
  };
};

const container = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

test("a nested watch is released when its page goes, after the chain got shorter", () => {
  const a = makeActor();
  const b = makeActor();
  const c = makeActor();
  const { spy, wrapped } = subscriptionCounter(b);
  const root = container();
  render(
    html`<p>
      ${watch(a, (sa) =>
        sa.context.label === "x"
          ? watch(wrapped, (sb) => watch(c, () => `deep ${sb.context.label}`))
          : watch(wrapped, (sb) => `short ${sb.context.label}`),
      )}
    </p>`,
    root,
  );
  a.send(relabel.create({ label: "short" }));
  const before = root.textContent?.trim();
  render(html`<p>${"other page"}</p>`, root);
  b.send(relabel.create({ label: "late" }));
  expect({ before, active: spy.active, text: root.textContent }).toEqual({
    before: "short x",
    active: 0,
    text: "other page",
  });
});

test("a released nested watch does not draw over the page that replaced it", () => {
  const route = makeActor();
  const a = makeActor();
  const b = makeActor();
  const c = makeActor();
  const pages = (label: string) =>
    label === "x"
      ? watch(a, () => watch(b, (sb) => watch(c, () => `deep ${sb.context.label}`)))
      : label === "album"
        ? watch(a, () => watch(b, (sb) => `album ${sb.context.label}`))
        : html`<b>sharing</b>`;
  const root = container();
  render(html`<main>${watch(route, (s) => pages(s.context.label))}</main>`, root);
  route.send(relabel.create({ label: "album" }));
  route.send(relabel.create({ label: "sharing" }));
  b.send(relabel.create({ label: "late" }));
  expect(root.textContent).toBe("sharing");
});
