# ContextInspector spec

Inspects the actor context tree, current or diffed against the previous change.

## Props

| Prop          | Type                  | Default     | Notes                                 |
| ------------- | --------------------- | ----------- | ------------------------------------- |
| `actor`       | `AnyActor`            | required    |                                       |
| `mode`        | `"current" \| "diff"` | `"current"` | diff uses the model's `prev` snapshot |
| `defaultOpen` | `boolean`             | `true`      |                                       |

## Render contract

- Renders **every** JS value type: functions → `ƒ name()`, symbols →
  `Symbol(desc)`, bigint → `123n`, Date → ISO, Map/Set → `Map(2)`, arrays →
  index-based walk, circular refs → `[Circular]` badge (ancestor stack, no
  throw), getter-throws → `[getter threw: …]` badge + continue.
- `undefined` vs missing distinguished in diff mode.
- Depth cap 8 with a collapse badge.
- `formatValue` never throws (try/catch → `"<unprintable>"`).

## Finite states

`ready` / `empty` (`{}` → note) / `error` (actor error surfaced, never blank).

## Don'ts

- No edit-in-place.
- Tree has `role="tree"` + proper a11y.
