> Experimental: API may change.

# @mantaq/lit

Bind a mantaq actor into a [lit-html](https://lit.dev/docs/libraries/standalone-templates/) template with one function, `watch(actor, select)`. It renders `select(snapshot)` now and again on every change, synchronously, so the DOM is current when `send` returns.

```sh
pnpm add @mantaq/lit lit-html
```

## Quick start

```ts
import { html, render } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { watch } from "@mantaq/lit";

const row = (t: Todo) => html`<li data-id=${t.id}><span>${t.text}</span></li>`;

render(
  html`<ul>
    ${watch(todos, (s) => repeat(s.context.items, (t) => t.id, row))}
  </ul>`,
  document.body,
);
```

`watch` subscribes while the part is connected and unsubscribes when it is cleared. Passing a new inline `select` on each render does not resubscribe, and the latest `select` is the one used. Passing a different actor moves the subscription.

## Gotchas

These are pinned by `src/lit-assumptions.test.ts`.

- **Key lists by `id`.** `repeat(items, (t) => t.id, row)` keeps and moves the existing `<li>` elements and writes only the text that changed. Keying by object identity recreates every row whenever items are cloned, and a plain `items.map(row)` reuses rows by index, so removing the first item rewrites the text of every row after it.
- **Components that take an item as a property do not see in-place edits.** A custom element with `.item=${t}` compares by `Object.is`, so a handler that mutates `t` leaves it stale. Bind the fields (`.text=${t.text}`), or replace the changed item with a new object.
- **Selectors run on every change.** `watch` does not compare values, because an in-place edit returns the same array again and must still update the list. lit already skips equal primitives, so keep selectors cheap.
- **`prev.context === snap.context` after an in-place edit.** Compare fields, not contexts, when you detect changes yourself.

## Not included

Scheduling options, value dedupe and a view-transition option (mantaq #296) are not part of this package yet.
