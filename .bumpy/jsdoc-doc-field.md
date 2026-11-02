---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

States, events and edges carry a `doc` field (schema v8): `@mantaq/inspect` reads the
leading JSDoc of `state(...)` / `event(...)` declarations and of `m.on` / `m.onAny`
calls, and the viewer panel shows it for the current state and each next step.
