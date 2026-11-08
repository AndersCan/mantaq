// @vitest-environment happy-dom
import { html, render } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { expect, test } from "vite-plus/test";
import { makeActor, relabel, rename } from "./test-actor.ts";
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

test("a reconnected watch shows a nested watch once and releases the old subscription", () => {
  const a = makeActor();
  const b = makeActor();
  const { spy, wrapped } = subscriptionCounter(b);
  const root = container();
  const part = render(
    html`<p>${watch(a, () => watch(wrapped, (sb) => `b ${sb.context.label}`))}</p>`,
    root,
  );
  part.setConnected(false);
  const disconnected = spy.active;
  part.setConnected(true);
  const reconnected = spy.active;
  b.send(relabel.create({ label: "late" }));
  part.setConnected(false);
  expect({ disconnected, reconnected, text: root.textContent, after: spy.active }).toEqual({
    disconnected: 0,
    reconnected: 1,
    text: "b late",
    after: 0,
  });
});

test("a directive result in an attribute part is not wrapped", () => {
  const a = makeActor();
  const root = container();
  render(html`<p title=${watch(a, () => watch(a, (sa) => sa.context.label))}>x</p>`, root);
  expect(root.querySelector("p")?.getAttribute("title")).toBe("x");
});

test("a nested watch that appears after a change is released with its page", () => {
  const route = makeActor();
  const b = makeActor();
  const { spy, wrapped } = subscriptionCounter(b);
  const root = container();
  render(
    html`<main>
      ${watch(route, (s) =>
        s.context.label === "album"
          ? watch(route, () => watch(wrapped, (sb) => `b ${sb.context.label}`))
          : "home",
      )}
    </main>`,
    root,
  );
  const first = root.textContent?.trim();
  route.send(relabel.create({ label: "album" }));
  const shown = { text: root.textContent?.trim(), active: spy.active };
  route.send(relabel.create({ label: "home" }));
  b.send(relabel.create({ label: "late" }));
  expect({ first, shown, active: spy.active, text: root.textContent?.trim() }).toEqual({
    first: "home",
    shown: { text: "b x", active: 1 },
    active: 0,
    text: "home",
  });
});

const items = (actor: ReturnType<typeof makeActor>) =>
  watch(actor, (s) =>
    repeat(
      s.context.items,
      (t) => t.id,
      (t) => html`<li>${t.text}</li>`,
    ),
  );

test("a reconnected watch keeps the elements of a directive result", () => {
  const a = makeActor();
  const root = container();
  const part = render(
    html`<ul>
      ${items(a)}
    </ul>`,
    root,
  );
  const before = [...root.querySelectorAll("li")];
  part.setConnected(false);
  part.setConnected(true);
  const after = [...root.querySelectorAll("li")];
  expect({ count: after.length, same: after.every((li, i) => li === before[i]) }).toEqual({
    count: 3,
    same: true,
  });
});

test("a change keeps the elements of a directive result inside a nested watch", () => {
  const a = makeActor();
  const b = makeActor();
  const root = container();
  render(
    html`<ul>
      ${watch(a, () => items(b))}
    </ul>`,
    root,
  );
  const before = [...root.querySelectorAll("li")];
  b.send(rename.create({ id: 2, text: "B" }));
  const after = [...root.querySelectorAll("li")];
  expect({
    text: root.textContent?.trim(),
    same: after.every((li, i) => li === before[i]),
  }).toEqual({
    text: "aBc",
    same: true,
  });
});
