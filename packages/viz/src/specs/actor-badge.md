# ActorBadge spec

Compact identity card: status dot + stats.

## Props

| Prop        | Type                  | Default                 | Notes |
| ----------- | --------------------- | ----------------------- | ----- |
| `actor`     | `AnyActor`            | required                |       |
| `name`      | `string \| undefined` | actor name or `"actor"` |       |
| `showStats` | `boolean`             | `true`                  |       |

## Finite states

`running` (ok dot) / `error` (err dot) / `done` (ok dot, done tag).

Stats line: `N states · N events · N effects · N regions`.

## Don'ts

- No counts computed by walking the DOM — derived from the graph model.
