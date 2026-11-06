// @vitest-environment happy-dom
import { html, nothing, render, type RootPart } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { expect, expectTypeOf, test } from "vite-plus/test";
import { makeActor, relabel, rename, reverse } from "./test-actor.ts";
import { watch } from "./watch.ts";

const container = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

const observe = (root: Node) => {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  return (type: string) => {
    records.push(...observer.takeRecords());
    return records.filter((r) => r.type === type).length;
  };
};

const lis = (root: Element) => [...root.querySelectorAll("li")];

const listView = (actor: ReturnType<typeof makeActor>) =>
  html`<ul>
    ${watch(actor, (s) =>
      repeat(
        s.context.items,
        (t) => t.id,
        (t) => html`<li data-id=${t.id}><span>${t.text}</span></li>`,
      ),
    )}
  </ul>`;

const spyOn = (actor: ReturnType<typeof makeActor>) => {
  const spy = { active: 0, total: 0 };
  return {
    spy,
    wrapped: {
      snapshot: () => actor.snapshot(),
      on: (event: "change", options: Parameters<typeof actor.on<"change">>[1]) => {
        spy.active += 1;
        spy.total += 1;
        const off = actor.on(event, options);
        return () => {
          spy.active -= 1;
          off();
        };
      },
    },
  };
};

test("text binding writes only the changed text node", () => {
  const actor = makeActor();
  const root = container();
  render(
    html`<p>${watch(actor, (s) => s.context.items[0]?.text)}</p>
      <i>${watch(actor, (s) => s.context.label)}</i>`,
    root,
  );
  const chars = observe(root);
  actor.send(rename.create({ id: 1, text: "1" }));
  actor.send(rename.create({ id: 1, text: "2" }));
  actor.send(rename.create({ id: 1, text: "3" }));
  expect({
    chars: chars("characterData"),
    p: root.querySelector("p")?.textContent,
    i: root.querySelector("i")?.textContent,
  }).toEqual({ chars: 3, p: "3", i: "x" });
});

test("attribute binding updates", () => {
  const actor = makeActor();
  const root = container();
  render(html`<p class=${watch(actor, (s) => s.context.label)}></p>`, root);
  actor.send(relabel.create({ label: "y" }));
  expect(root.querySelector("p")?.className).toBe("y");
});

test("list: rename edits one text node, reorder keeps elements", () => {
  const actor = makeActor();
  const root = container();
  render(listView(actor), root);
  const before = lis(root);
  const chars = observe(root);
  actor.send(rename.create({ id: 2, text: "B" }));
  expect({
    chars: chars("characterData"),
    same: lis(root).every((li, i) => li === before[i]),
  }).toEqual({ chars: 1, same: true });
  actor.send(reverse.create());
  expect({
    ids: lis(root).map((li) => li.getAttribute("data-id")),
    same: [...lis(root)].reverse().every((li, i) => li === before[i]),
  }).toEqual({ ids: ["3", "2", "1"], same: true });
});

test("first render runs the selector once: the seed call is ignored", () => {
  const actor = makeActor();
  const root = container();
  let calls = 0;
  render(html`<p>${watch(actor, (s) => ((calls += 1), s.context.label))}</p>`, root);
  expect({ calls, text: root.textContent }).toEqual({ calls: 1, text: "x" });
});

test("re-rendering with a new inline select subscribes once and uses the latest select", () => {
  const actor = makeActor();
  const { spy, wrapped } = spyOn(actor);
  const root = container();
  const view = (suffix: string) => html`<p>${watch(wrapped, (s) => s.context.label + suffix)}</p>`;
  render(view("1"), root);
  render(view("2"), root);
  render(view("3"), root);
  actor.send(relabel.create({ label: "q" }));
  expect({ total: spy.total, text: root.textContent }).toEqual({ total: 1, text: "q3" });
});

test("swapping the actor moves the subscription", () => {
  const a = makeActor();
  const b = makeActor();
  const { spy, wrapped } = spyOn(a);
  const root = container();
  const view = (actor: typeof wrapped | typeof b) =>
    html`<p>${watch(actor, (s) => s.context.label)}</p>`;
  render(view(wrapped), root);
  render(view(b), root);
  a.send(relabel.create({ label: "old" }));
  const afterOld = root.textContent;
  b.send(relabel.create({ label: "new" }));
  expect({ afterOld, now: root.textContent, active: spy.active }).toEqual({
    afterOld: "x",
    now: "new",
    active: 0,
  });
});

test("clearing unsubscribes and reconnecting catches up", () => {
  const actor = makeActor();
  const { spy, wrapped } = spyOn(actor);
  const root = container();
  render(html`<p>${watch(wrapped, (s) => s.context.label)}</p>`, root);
  expect(spy.active).toBe(1);
  render(nothing, root);
  expect(spy.active).toBe(0);

  const part: RootPart = render(html`<p>${watch(wrapped, (s) => s.context.label)}</p>`, root);
  part.setConnected(false);
  const disconnected = spy.active;
  actor.send(relabel.create({ label: "missed" }));
  const stale = root.textContent;
  part.setConnected(true);
  expect({ disconnected, stale, active: spy.active, now: root.textContent }).toEqual({
    disconnected: 0,
    stale: "x",
    active: 1,
    now: "missed",
  });
});

test("infers the context type from the actor", () => {
  const actor = makeActor();
  watch(actor, (s) => {
    expectTypeOf(s.context.items).toEqualTypeOf<{ id: number; text: string }[]>();
    // @ts-expect-error `missing` is not a context field, so selecting it must not compile
    return s.context.missing;
  });
});
