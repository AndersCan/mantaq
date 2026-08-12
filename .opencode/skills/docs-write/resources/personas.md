# Persona Review Checklists

Personas from `ux-research/personas-and-journeys.md` plus the tech-writer
persona S1 from `ux-research/viz-prioritization.md`. Run the loop for every
docs page you write or touch.

Order matters. Each pass has a lens. Fix violations before the next pass.
Last pass is Tech Writer (accuracy) — it must be clean to finish.

## Pass 1 — XState Refugee (Persona 1)

Senior frontend engineer. Migrating a multi-step checkout from XState before a
deadline. Reads docs to replace a solution, not to learn CS. Hates massive API
surfaces, deprecated patterns, docs that reference things he never used.

**Questions**

- Can I map this page onto my own checkout flow without translating?
- Is the page a single coherent slice, or does it spray unrelated examples?
- Does the page show the machine from the previous page, expanded — or a brand
  new machine?
- Are API surface, options, and concepts shown in digestible chunks, not a dump?
- Would a junior on my team follow this without me re-explaining?

**Violations**

- New example appeared mid-page.
- Event/state names differ from the running example.
- Page opens without referencing the machine built so far.
- A page teaches the same thing as an earlier page (re-explaining actors, etc.).

## Pass 2 — UI Debugger (Persona 2)

Mid-level frontend developer. Debugs state misbehavior by exploration. Wants to
see state flow, not read walls. Gets frustrated by invisible state.

**Questions**

- Can I trace every transition by reading the page? Each `m.on(...)` line shows
  state A + event B → state C?
- Are intermediate states visible? (e.g., `submitting` between `payment` and
  `success`)
- Does the page say what happens on each event (not just show code)?
- Can I run the example and observe transitions — or does it need setup I don't
  have?

**Violations**

- Transition effects not explained ("this leads to success" missing).
- Code block with no plain-language walk-through.
- Back navigation (`BACK` handling) unexplained.
- Error path invisible (how does `PAYMENT_FAIL` reach `error`?).

## Pass 3 — Library Builder (Persona 3)

OSS maintainer. Reads source to verify claims. Needs exact API truth — imports
that exist, exports that match docs, no phantom features.

**Questions**

- Does every `@mantaq/*` import in this page exist as a real export?
- Does the snippet compile against the real API (not a remembered one)?
- Are internals shown honestly — no hand-waving "under the hood" claims?
- Would I trust this page enough to link it from my own library docs?

**Violations**

- Import of a symbol not exported by the package (check `packages/*/src/index.ts`).
- API usage that differs from the canonical `checkout.actor.test.ts`.
- Claim about behavior not backed by the test suite.
- IDs that exist in the snippet but not in the canonical registry.

## Pass 4 — Team Lead (Persona 4)

Engineering manager. Evaluating Mantaq for a 15-person team before Q3 planning.
Decides based on whether the whole docs story coheres and onboarding cost.

**Questions**

- Reading intro → testing guide in order, is there one continuous build?
- Would a new hire get lost jumping between pages? (Every page must say where
  the example stands.)
- Does each page end pointing at the next page's expansion?
- Can I demo this to product leadership from the docs alone?

**Violations**

- Page that assumes knowledge introduced nowhere.
- Example changes identity between pages.
- No forward pointer at the end of a page.
- A concept promised in the intro (`VirtualClock`, sugar) never picked up.

## Pass 5 — Tech Writer (Persona 5, S1)

Writes and owns docs. Accuracy over style. Fails on docs describing packages
that don't exist, examples that don't run, or drift between pages.

**Questions**

- Every snippet typechecks or is an explicitly marked fragment?
- Every state/event ID matches the canonical registry?
- Reference pages list real exports only?
- Does the page match the voice and structure of the rest of the docs?

**Violations**

- Stale API (old event shape, renamed export).
- Example continuity gate fails (run `vp run docs:check`).
- Snippet with a typo that breaks the mental model.

## Loop output

For each pass, produce:

```
PERSONA: <name>
VERDICT: pass | fail
VIOLATIONS:
- <page> — <issue>
FIXED: <what changed>
```

Fail any pass → fix → re-run that pass. All five pass → page done.
