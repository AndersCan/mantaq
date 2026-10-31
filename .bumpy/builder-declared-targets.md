---
"@mantaq/core": minor
"@mantaq/traversal": minor
---

**Breaking.** Builder handlers take `event` instead of `eventRef`, and declare
their targets in `to`:

```ts
m.on(idle, { event: GO, to: [busy, done], handler: () => ({ state: busy }) });
```

The handler's return type is narrowed to `to[number]`: returning an unlisted
state fails to compile, and omitting `to` means the handler can only stay. The
builder records `to` in `BuiltMaps.targets` (on `actor.options.targets`), so the
full transition graph is static data. `buildGraph` now draws one edge per
declared target and a `stay` edge for handlers without `to`. `onAny` edges
leave a single `*` source (`ANY_NODE_NAME`, `isAnyNode`) instead of being
copied onto every state. Probing only labels edges with contexts and emits.

Migrate with `node packages/codemod/src/cli.ts <tsconfig.json>...`, then `vp check`.
