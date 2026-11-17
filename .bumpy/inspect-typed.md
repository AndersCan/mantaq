---
"@mantaq/inspect": minor
---

Breaking: inspect reads only `machine("<id>", { create })` exports. It no longer guesses from a function's parameters, its name or its export shape.

- A plain function that returns an actor (`createCheckoutActor`) and a bare actor export are not machines. Wrap them: `export const checkout = machine("checkout", { create: ({ clock }) => Actor({ clock, … }) })`.
- The machine id is the string you pass to `machine(...)`. The export name no longer matters, and `machineId` is removed.
- `InspectTarget` is `{ machine, source?, payloads?, tests?, fuzz?, expectations? }`. The `{ id, create }` form is removed.
- `recordRuns(machine)` takes a machine, not a function. Before: `const make = recordRuns(createTimedActor); make(clock)`. After: `const make = recordRuns(timed); make.create({ clock })`.
- Expectations name their machine and may have any export name. Before: `export const checkoutExpectations: Expectations<typeof createCheckoutActor> = { payment: { neverSee: [...] } }`. After: `export const limits: Expectations<typeof checkout> = { machine: "checkout", states: { payment: { neverSee: [...] } } }`.
- The live page no longer patches a real clock. Every machine gets the page's virtual clock through `create({ clock })`. A machine whose actor runs on another clock is drawn, not fuzzed and not live, with a warning.
