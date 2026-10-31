# @mantaq/codemod

Source migrations for breaking Mantaq API changes. Each transform reads the
TypeScript type checker, not text patterns, and is idempotent.

```sh
node packages/codemod/src/cli.ts packages/*/tsconfig.json [--dry-run]
vp fmt && vp check
```

`vp check` is the oracle. Anything the codemod cannot resolve is left as a
compile error on purpose, never guessed.

## Transforms

Run in order (`TRANSFORMS` in `src/migrate.ts`). The program is rebuilt between
steps, so later transforms see earlier rewrites.

| name              | change                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-key`       | `m.on(s, { eventRef: E })` → `m.on(s, { event: E })`. Only on calls whose receiver is an `ActorBuilder` (aliases included).                                                                                                                                                                                    |
| `declare-targets` | Adds `to: [...]` from the handler's inferred return type. Expressions come from the enclosing `Actor({ states })` array, else from the handler's own `state:` values bound outside it. A non-literal or unreachable target becomes `to: [/* codemod: unresolved ... */]`, which fails `vp check` at that call. |

## Adding a migration

1. Write `src/transforms/<name>.ts` exporting a `Transform` (`edits(file, checker) => Edit[]`). Return no edits for already-migrated code.
2. Append it to `TRANSFORMS`.
3. Cover it in `src/migrate.test.ts` (and `*.error.test.ts` for unresolved cases) with the `machine()` fixture.
4. Make the breaking API change, run the CLI over the repo, then `vp check` and `vp test`.
