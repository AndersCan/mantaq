// @vitest-environment happy-dom
import { LitElement, html as litHtml } from "lit";
import { AsyncDirective } from "lit-html/async-directive.js";
import { html, nothing, render, type RootPart } from "lit-html";
import { directive } from "lit-html/directive.js";
import { repeat } from "lit-html/directives/repeat.js";
import { expect, test } from "vite-plus/test";

type Item = { id: number; text: string };
type Counts = { characterData: number; childList: number; attributes: number };

const seed = (): Item[] => [
  { id: 1, text: "a" },
  { id: 2, text: "b" },
  { id: 3, text: "c" },
];

const clone = (items: Item[]): Item[] => items.map((t) => ({ ...t }));

const rowTemplate = (t: Item) => html`<li data-id=${t.id}><span>${t.text}</span></li>`;

const container = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

const rows = (root: Element): Map<number, Element> =>
  new Map(
    [...root.querySelectorAll("li[data-id]")].map((li) => [Number(li.getAttribute("data-id")), li]),
  );

const observe = async (root: Node, run: () => unknown): Promise<Counts> => {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  await run();
  await Promise.resolve();
  records.push(...observer.takeRecords());
  observer.disconnect();
  const count = (type: string) => records.filter((r) => r.type === type).length;
  return {
    characterData: count("characterData"),
    childList: count("childList"),
    attributes: count("attributes"),
  };
};

const created = (before: Map<number, Element>, after: Map<number, Element>): number => {
  const old = new Set(before.values());
  return [...after.values()].filter((el) => !old.has(el)).length;
};

const keyed = (items: Item[]) => repeat(items, (t) => t.id, rowTemplate);

test("A0: MutationObserver reports characterData for text.data and childList for a move that keeps identity", async () => {
  // instrument control, no lit
  const root = container();
  root.innerHTML = "<p>x</p><p>y</p>";
  const text = root.querySelector("p")!.firstChild as Text;
  const first = root.children[0]!;
  const data = await observe(root, () => {
    text.data = "z";
  });
  expect(data).toEqual({ characterData: 1, childList: 0, attributes: 0 });
  const move = await observe(root, () => {
    root.insertBefore(root.children[1]!, root.children[0]!);
  });
  expect(move.characterData).toBe(0);
  expect(move.childList).toBeGreaterThan(0);
  expect(root.children[1]).toBe(first);
});

test("A1: repeat with id keys keeps every li and records zero mutations for deep-cloned equal items", async () => {
  // lit-html directives/repeat.js:293-313, lit-html.js:880,:1205-1206
  const root = container();
  const items = seed();
  render(keyed(items), root);
  const before = rows(root);
  const counts = await observe(root, () => render(keyed(clone(items)), root));
  const after = rows(root);
  expect(created(before, after)).toBe(0);
  expect(counts).toEqual({ characterData: 0, childList: 0, attributes: 0 });
});

test("A2: repeat keyed by item identity recreates every row for clones and keeps them for the same objects", () => {
  // repeat.js key diff compares key objects with ===
  const root = container();
  const items = seed();
  const byIdentity = (list: Item[]) => repeat(list, (t) => t, rowTemplate);
  render(byIdentity(items), root);
  const before = rows(root);
  render(byIdentity(items), root);
  expect(created(before, rows(root))).toBe(0);
  render(byIdentity(clone(items)), root);
  expect(created(before, rows(root))).toBe(3);
});

test("A3: reorder with id keys moves the existing li Elements and writes no text", async () => {
  // repeat.js:306,313 insertPart moves old part DOM
  const root = container();
  const items = seed();
  render(keyed(items), root);
  const before = rows(root);
  const reordered = [items[2]!, items[0]!, items[1]!];
  const counts = await observe(root, () => render(keyed(reordered), root));
  const after = rows(root);
  expect(created(before, after)).toBe(0);
  expect([...root.querySelectorAll("li")].map((li) => li.getAttribute("data-id"))).toEqual([
    "3",
    "1",
    "2",
  ]);
  expect(after.get(1)).toBe(before.get(1));
  expect(counts.characterData).toBe(0);
});

test("A4: in-place edit of one item writes exactly one text node", async () => {
  // lit-html.js:1016 _update, :948-969 _commitText sets node.data
  const root = container();
  const items = seed();
  render(keyed(items), root);
  const before = rows(root);
  const counts = await observe(root, () => {
    items[1]!.text = "B!";
    render(keyed(items), root);
  });
  expect(counts).toEqual({ characterData: 1, childList: 0, attributes: 0 });
  expect(root.querySelectorAll("span")[1]!.textContent).toBe("B!");
  expect(created(before, rows(root))).toBe(0);
});

test("A5: add and remove with id keys create or drop only that row", () => {
  // repeat.js:326,331 removePart
  const root = container();
  const items = seed();
  render(keyed(items), root);
  const before = rows(root);
  const added = [...items, { id: 4, text: "d" }];
  render(keyed(added), root);
  const afterAdd = rows(root);
  expect(created(before, afterAdd)).toBe(1);
  expect(afterAdd.has(4)).toBe(true);
  render(keyed(added.filter((t) => t.id !== 2)), root);
  const afterRemove = rows(root);
  expect([...afterRemove.keys()]).toEqual([1, 3, 4]);
  expect(created(afterAdd, afterRemove)).toBe(0);
  expect(afterRemove.get(1)).toBe(before.get(1));
  expect(afterRemove.get(3)).toBe(before.get(3));
});

test("A6: index-keyed map after removing index 0 rewrites every remaining row and drops only the last", async () => {
  // lit-html.js iterable commit reuses parts by index
  const root = container();
  const items = seed();
  const plain = (list: Item[]) => html`${list.map(rowTemplate)}`;
  render(plain(items), root);
  const before = [...root.querySelectorAll("li")];
  const counts = await observe(root, () => render(plain(items.slice(1)), root));
  const after = [...root.querySelectorAll("li")];
  expect(after.length).toBe(2);
  expect(after[1]).toBe(before[1]);
  expect(after[0]).toBe(before[0]);
  expect(after.map((li) => li.getAttribute("data-id"))).toEqual(["2", "3"]);
  expect(counts.characterData).toBe(2);
});

class TodoRow extends LitElement {
  static override properties = { item: { attribute: false } };
  declare item: Item;
  renders = 0;
  protected override render() {
    this.renders += 1;
    return litHtml`<b>${this.item.text}</b>`;
  }
}
customElements.define("todo-row", TodoRow);

test("A7: LitElement child ignores an in-place mutated item and updates for a new object", async () => {
  // lit.dev/docs/components/properties: default hasChanged is !Object.is
  const root = container();
  const item = { id: 1, text: "a" };
  const tpl = (it: Item) => html`<todo-row .item=${it}></todo-row>`;
  render(tpl(item), root);
  const el = root.querySelector("todo-row") as TodoRow;
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toBe("a");
  item.text = "mutated";
  render(tpl(item), root);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toBe("a");
  expect(el.renders).toBe(1);
  render(tpl({ ...item }), root);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toBe("mutated");
  expect(el.renders).toBe(2);
});

class Probe extends AsyncDirective {
  static last: Probe | undefined;
  connected = 0;
  disconnectedCount = 0;
  reconnectedCount = 0;
  render(initial: unknown) {
    Probe.last = this;
    return initial;
  }
  push(value: unknown) {
    this.setValue(value);
  }
  override disconnected() {
    this.disconnectedCount += 1;
  }
  override reconnected() {
    this.reconnectedCount += 1;
  }
}
const probe = directive(Probe);

test("A8a: setValue from outside render updates the part", () => {
  // async-directive.js:219-222
  const root = container();
  render(html`<p>${probe("start")}</p>`, root);
  expect(root.querySelector("p")!.textContent).toBe("start");
  Probe.last!.push("later");
  expect(root.querySelector("p")!.textContent).toBe("later");
});

test("A8b: disconnected runs when the part is cleared; reconnected after setConnected(false/true)", () => {
  // async-directive.js notifyChildPartConnectedChanged; render(nothing) clears the part
  const root = container();
  render(html`<p>${probe("x")}</p>`, root);
  const first = Probe.last!;
  render(nothing, root);
  expect(first.disconnectedCount).toBe(1);

  const root2 = container();
  const part = render(html`<p>${probe("y")}</p>`, root2) as RootPart;
  const second = Probe.last!;
  part.setConnected(false);
  expect(second.disconnectedCount).toBe(1);
  part.setConnected(true);
  expect(second.reconnectedCount).toBe(1);
});

test("A8c: repeated setValue(repeat(...)) keeps keyed reuse", async () => {
  // setValue -> part._$setValue(value, this) resolves nested directives against the async directive
  const root = container();
  const items = seed();
  render(
    html`<ul>
      ${probe(keyed(items))}
    </ul>`,
    root,
  );
  const before = rows(root);
  Probe.last!.push(keyed(clone(items)));
  Probe.last!.push(keyed([items[2]!, items[0]!, items[1]!]));
  const after = rows(root);
  expect(created(before, after)).toBe(0);
  const counts = await observe(root, () =>
    Probe.last!.push(keyed(clone([items[2]!, items[0]!, items[1]!]))),
  );
  expect(counts).toEqual({ characterData: 0, childList: 0, attributes: 0 });
});

test("A9: re-committing an equal primitive records zero mutations in child and attribute parts", async () => {
  // lit-html.js:880, :1205-1206
  const root = container();
  const tpl = (text: string, cls: string) => html`<p class=${cls}>${text}</p>`;
  render(tpl("a", "x"), root);
  const same = await observe(root, () => render(tpl("a", "x"), root));
  expect(same).toEqual({ characterData: 0, childList: 0, attributes: 0 });
  const changed = await observe(root, () => render(tpl("b", "y"), root));
  expect(changed.characterData).toBe(1);
  expect(changed.attributes).toBe(1);
});
