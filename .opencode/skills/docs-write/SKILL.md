---
name: docs-write
description: Write and review Mantaq documentation with a single running example and persona-based review. Use when writing, editing, or reviewing any docs content (apps/docs mdx pages, guides, examples).
argument-hint: "[page or section to write/review]"
allowed-tools: Read Grep Glob Bash Edit Write
metadata:
  internal: false
---

# Write and review Mantaq docs

Write docs with ONE running example threaded through every page. Review with five personas from UX research. Verify with `vp run docs:check`.

## The running example

The docs tell one story: a **multi-step checkout form**.

- Canonical example: `.opencode/skills/docs-write/resources/example.mdx`
- Runnable source of truth: `packages/examples/checkout.actor.test.ts`
- Entity registry, full machine, page→slice map: see `resources/example.mdx`

Before writing, read both files. The registry is law: every narrative page uses
only IDs from it.

## Authoring rules

1. **One example.** All narrative pages use the checkout form. No new machines.
   - Extension machines (fraud monitor, order workers) allowed — they continue
     the same story and their IDs are in the registry. Introduce each on its own
     page.
   - Reference pages (`reference/*`) are exempt from the single-example rule but
     snippets must still compile and use real exports.
2. **Same IDs everywhere.** State/event IDs identical across pages. Checked by
   `docs:check`.
3. **Expansion contract.** Page N builds the machine from page N-1. Each page:
   - Opens referencing what the reader built: "The checkout machine from the
     last page. Now add effects."
   - Adds the smallest slice showing the concept.
   - Stands alone — no "Next:" forward pointer. Sidebar order is the thread.
4. **No dead code.** Every snippet compiles against the real API, or is an
   explicitly marked fragment (`// ...unchanged`).
5. **Full blocks when needed.** When a page extends the machine, show the
   complete updated machine where the reader needs it. `// ...unchanged` for
   untouched parts. Never force a mental merge of scattered fragments.
6. **What and why, first.** Every page and every feature section opens by
   answering both, before any code:
   - **What** — the thing, in one line. What is it? What does it do?
   - **Why** — the problem it solves and when to reach for it. Why does it
     exist? What breaks without it? What is it _not_ (the misreadings)?
     A reader must be able to say what a feature is and why it exists after the
     first paragraph, without decoding the API. Naming and signatures live below
     the what/why, never above. If the signature invites a wrong reading, the
     what/why must preempt it — e.g. ActorMap: "keyed registry of one actor
     type, not a collection of things."
7. **Human voice.** Natural prose. Tight, but written like a person explaining
   to another person — full sentences, no caveman fragments ("Effect. Runs on
   state entry."). Technical terms exact. Matches existing docs.

## Steps

### 1. Establish the thread

Identify the page. Map it to the slice table in `resources/example.mdx`.

Read the previous page and the next page in sidebar order
(`apps/docs/astro.config.mjs`). The page must pick up where the previous one
left off and hand off to the next.

### 2. Write or edit

Follow the expansion contract. Use only canonical IDs. Mirror the canonical
machine structure from `checkout.actor.test.ts` — handler shapes, `get()` /
`set()` calls, effect wiring.

### 3. Run automated gates

```bash
vp run docs:check
```

Fails on: non-canonical IDs in narrative pages, imports that aren't real
package exports, canonical example drift.

### 4. Persona review loop

Read `resources/personas.md`. Run each pass over the page(s):

1. XState Refugee — migration lens
2. UI Debugger — exploration lens
3. Library Builder — API truth lens
4. Team Lead — onboarding/story coherence lens
5. Tech Writer — accuracy lens

Produce the verdict block from `resources/personas.md` for each pass. Fix
violations. Re-run the failed pass.

### 5. Finish

- Run `vp check` (format, lint, type).
- Run `vp test` (canonical example runs).
- If you changed `packages/examples/checkout.actor.test.ts`, update
  `resources/example.mdx` to match, and re-run examples tests.
- Record the change with a bump file (`add-change` skill) if it affects
  publishable packages.

## Pitfalls

- Never rename an entity mid-docs. Registry is law.
- Never teach a concept with a throwaway machine when the checkout slice can
  show it.
- Never leave an example half-built across a page boundary — each page must
  stand alone (open: where we are).
- Snippet fragments (`setup: (m) => ...`) are fine when marked, but the full
  machine must exist on some page.
