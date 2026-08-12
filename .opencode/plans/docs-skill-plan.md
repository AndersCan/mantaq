# Documentation Skill Plan

> **STATUS: BUILT.** All 8 implementation steps done. Gates green. See branch `feat/docs-skill`.

## Problem

Mantaq docs (`apps/docs`, Astro/Starlight) use different example every page:

| Page                       | Example                              |
| -------------------------- | ------------------------------------ |
| `introduction.mdx`         | `idle`/`running` start-stop machine  |
| `actors.mdx`               | `idle`/`active` machine              |
| `events.mdx`               | `FETCH`/loading, `AUTH_DONE`, cancel |
| `sugar/*`                  | own machines each                    |
| `guides/actor-testing.mdx` | own machine                          |

Reader can't track single coherent thing. Each page restarts mental model. Confusing.

Goal: **one running example from start to finish. Each page expands it.** New page builds on machine from previous page.

## Skill design

Name: `docs-write`
Location: `.opencode/skills/docs-write/`
Description trigger: writing, editing, reviewing Mantaq documentation.

Skill has two halves:

1. **Authoring rules** — single running example, expansion contract, continuity rules.
2. **Persona review loop** — review docs as each persona from `ux-research/personas-and-journeys.md` (+ tech-writer persona S1 from `ux-research/viz-prioritization.md`).

### Recommended running example: multi-step checkout flow

Grounds in UX research:

- Persona 1 (XState Refugee) — goal: migrate "complex multi-step checkout flow". Docs example = that flow.
- Journey 1 success criteria — "simple login flow". Checkout extends it (guest checkout).
- Journey 2 — "multi-step form state machine". Checkout matches.

Rich enough for whole docs: hierarchical states, guards, context, effects, parallel regions, VirtualClock testing, sugar helpers.

Outline:

```
States:   cart → checkout(shipping → payment → confirm) → complete
          + cancelled, payment_failed
Events:   ADD_ITEM, REMOVE_ITEM, CHECKOUT, SHIPPING_DONE,
          PAYMENT_SUBMITTED, PAYMENT_SUCCESS, PAYMENT_FAILED, CANCEL
Context:  items[], shipping address, payment status
Effects:  charge card (async, abortable), send confirmation,
          withTimeout(payment), withPromise(charge)
Sugar:    matches(checkout, "payment"), batch add items,
          ActorMap per cart line, dynamic regions
Testing:  VirtualClock for payment timeout
```

Threaded through every page:

| Page                   | Slices from checkout flow                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| introduction           | 3 states, 2 events. Minimal.                                                                    |
| actors                 | Build checkout actor. Send ADD_ITEM.                                                            |
| events                 | Checkout events with payload (`ADD_ITEM { sku, qty }`).                                         |
| states                 | Hierarchical: checkout region with nested steps.                                                |
| context                | Cart contents. Add item mutates context.                                                        |
| effects                | Charge card on payment entry.                                                                   |
| sugar/matching         | `matches(checkout, "payment")`                                                                  |
| sugar/batch-creation   | `states` helper, bulk add items                                                                 |
| sugar/effect-helpers   | `withTimeout`, `withPromise` on payment                                                         |
| sugar/dynamic-children | Cart lines as children                                                                          |
| guides/actor-testing   | Test checkout machine with VirtualClock                                                         |
| reference/*            | API reference stays generic (reference ≠ narrative). Snippets reference checkout where natural. |

## Files to create

1. `.opencode/skills/docs-write/SKILL.md` — main skill
   - Authoring rules below
   - Persona loop steps
   - Verification gates
2. `.opencode/skills/docs-write/resources/example.mdx` — canonical checkout example. Single source of truth for entity IDs, full machine code, per-page slices.
3. `.opencode/skills/docs-write/resources/personas.md` — persona review checklists. Derived from `ux-research/personas-and-journeys.md` + viz-prioritization S1.
4. `scripts/docs-check.mjs` — automated gates (below). Wired as `vp run docs:check` task in `vite.config.ts`.

## Authoring rules

1. **One example.** All narrative pages use checkout flow. No new standalone machines.
   - Exception: tiny isolated illustration, only if checkout slice impossible. Must state why.
   - Exception: reference pages. API reference documents surface, not narrative.
2. **Same IDs everywhere.** State IDs, event IDs, variable names identical across pages. Canonical list in `resources/example.mdx`. Grep-verifiable.
3. **Expansion contract.** Page N builds machine from page N-1. Each page:
   - Opens referencing what reader built before: "Checkout machine from previous page. Now add effects."
   - Adds smallest slice demonstrating concept.
   - Closes with pointer to next: "Next: test this checkout machine."
4. **No dead code.** Every snippet compiles and runs on the running example.
5. **Full code blocks win.** When a page adds to the machine, show complete updated machine when reader needs it (never force mental merge), use `// ... unchanged` for untouched parts.

## Persona review loop

After writing/editing, review as each persona. Each pass produces verdict + violations.

| Persona          | Lens        | Key questions                                                                                                      |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| XState Refugee   | Migration   | Can I map this to my checkout? API surface shown in digestible chunks, not dumped?                                 |
| UI Debugger      | Exploration | Can I follow state flow without reading walls? Intermediate states visible? Each transition result stated?         |
| Library Builder  | Internals   | Do imports match real exports? Can I verify against source? (Maps critical friction: API mismatch exports vs docs) |
| Team Lead        | Adoption    | Story coheres end-to-end? New hire can walk intro→test guide without getting lost? Evaluation-ready?               |
| Tech Writer (S1) | Accuracy    | Every symbol documented exists. Examples run. No phantom features.                                                 |

Loop: write → persona passes → fix violations → re-run → done.

## Verification gates (automated)

Tie to vision.md (`vp run guard` north stars):

1. **Example continuity.** Grep all narrative pages: every state/event ID in page must exist in canonical example. No orphan IDs.
2. **API truth.** Every `@mantaq/*` import in docs matches real exports. (UX critical friction #1.)
3. **Snippets typecheck.** Extract `ts` code blocks, compile against workspace. "If it typechecks, it runs correct."
4. **No example drift.** Canonical example file changed? Diff against `git log` — skill must re-run review.

## Decisions (confirmed)

1. Running example: **multi-step checkout flow**.
2. Skill scope: **author + rewrite**. Skill migrates existing 17 pages to checkout thread AND writes new docs.
3. Reference pages: exempt from single-example rule, snippets must still typecheck.
4. Keep caveman house style.

## Implementation order

1. Define canonical checkout example. Freeze entity IDs. Full machine code compiles.
2. Write `resources/example.mdx` + per-page slices.
3. Write `resources/personas.md` checklists.
4. Write `SKILL.md`.
5. Write `scripts/docs-check.mjs` + wire `vp run docs:check`.
6. Apply skill: rewrite all narrative docs pages to checkout thread.
7. Run persona review loop, fix.
8. Run `vp check` + `vp run docs:check` + `vp run guard`.
