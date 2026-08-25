---
"@mantaq/core": minor
"@mantaq/traversal": minor
"@mantaq/test": minor
---

Named effects: `m.effect(stateRef, { name, fn })` — the name is required and identifies
the effect in tests and history. Effects are now recorded when they actually run:
`TransitionInfo` carries `effects: string[]`, and `@mantaq/traversal` history effect
records are `{ stateName, effectName }` instead of being inferred from registration.
Test harness assertions take both names: `assertEffectRan(stateName, effectName)`,
`assertEffectNeverRan(stateName, effectName)`, `wasEffectRun(stateName, effectName)`.
Breaking: all `m.effect(stateRef, fn)` call sites must pass `{ name, fn }`.
