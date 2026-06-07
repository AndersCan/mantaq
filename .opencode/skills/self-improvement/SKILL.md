---
name: self-improvement
description: Substantial continuous improvements focused on reducing core API surface and deep documentation. One substantive change per run. Branch from wip, PR to wip, use ICM + bumpy.
---

# Self-Improvement Skill

Agent performs continuous improvements. Caveman output everywhere except code.

## Goal

**Primary**: Improve actor model DX. All features must be related to the actor model.

**Core must contain ONLY primitives**:
`Actor`, `state`, `event`, `VirtualClock`, `Any`, and their types.

**Sugar scope — actor-model-specific only**:

- `matches()` — snapshot pattern matching
- `tag()` — multi-state matching
- `ActorMap` — multi-actor management
- `states()`/`events()` — batch creators
- `broadcast()` — fan-out events
- `withTimeout`/`withPromise`/`onSuccess`/`onError` — effect helpers
- `isIn`/`activeLeaves` — query utilities

**Out of scope — do NOT add to sugar**:

- Generic utilities (deep merge, pick, omit, debounce) — use lodash/ramda/etc
- Features that could be standalone packages
- Anything not related to actor model state machines

**Task priority** (highest first):

1. Bug fixes found during exploration or testing
2. Missing actor model features (guards, region-to-region communication, effects scoping)
3. DX pain points documented in example files
4. Type safety improvements
5. Test coverage for untested actor model behavior

**Secondary**: Deep documentation (patterns with anti-patterns, not tables or TOCs).

## Branching

- Branch from `wip` (integration branch)
- All PRs target `wip`
- Branch naming: `self-improvement/<short-description>`

## Time Limit

- **15 minutes max** per agent run
- Track start time. Stop and commit partial work if approaching limit.

## Core Loop

### 1. Init

```bash
rtk git checkout wip && rtk git pull
```

### 2. Check for existing work

```bash
icm recall "self-improvement" -t improvements
```

- If existing branch with incomplete work found → `git checkout` that branch, continue from there.
- If no existing work → pick new task from backlog or identify improvement.

### 3. Check convergence

Before starting work, read recent self-improvement commits to avoid repeating:

```bash
git log --oneline --grep="self-improvement" -20
```

If the area you planned to improve was already covered, pick a different area.

### 3b. Discover tasks

Search for high-value work:

```bash
# Find documented pain points
rg "TODO|FIXME|HACK|pain point|missing|would be nice" packages/

# Check example files for DX friction
rg "No declarative|awkward|verbose|not supported" packages/examples/

# Find type safety issues
rg "as any" packages/ --include "*.ts"

# Check GitHub issues if available
gh issue list
```

Priority: bugs > missing features > DX pain points > type safety > test coverage.

Skip: generic utils, organizational changes, README edits, boilerplate fixes.

### 4. Branch

```bash
git checkout -b self-improvement/<short-description>
```

### 5. Pick approach

Choose ONE approach per run:

**A) Code quality** — reduce core API, fix casts, improve types

- Check `packages/core/src/index.ts` — if it exports non-primitives, fix that
- Check `packages/core/src/actor.ts` for reducible type casts
- If reducing core API, ensure sugar re-exports what users need

**B) Deep documentation** — patterns with anti-patterns, not organizational

- If improving documentation, make it DEEP (patterns + anti-patterns)

**C) Stress-test the API** — try to solve a real problem, find friction

- Pick a real-world problem (e.g., undo/redo, optimistic updates, debounced search, multi-step wizard, WebSocket reconnection)
- Write a failing test or prototype in `packages/examples/` that solves it using core + sugar
- If the actor model handles it cleanly → ship the example as documentation
- If you hit friction (wrong types, missing API, awkward patterns) → that friction IS the improvement:
  - Missing feature in sugar? Add it.
  - Core API forcing casts? Fix the types.
  - Concept missing entirely? Design the minimal API for it.
- Document the problem and solution in the PR body

### 6. Implement

- **ONE substantive change per run** — not multiple shallow ones
- No comments in code
- Maintain strict type safety
- If unable to find meaningful work, store summary in ICM and stop — do not pad

### 7. Self-review before committing

Verify your own work:

- [ ] Core exports fewer things than before? (or types improved?)
- [ ] No new types/features added to core?
- [ ] No unnecessary casts added?
- [ ] Changes are substantive, not organizational?
- [ ] Tests pass?
- [ ] Would a user actually benefit from this change?
- [ ] If stress-testing: did you find and fix real friction, or just write example code?

If you can't check most of these boxes, reconsider whether the change is worth shipping.

### 8. Verify

Run checks. Max **5 attempts** to fix failing tests/checks.

```bash
vp check
vp test --reporter agent
```

- If checks pass → proceed to commit.
- If checks fail → fix and retry (up to 5 times).
- If core logic unexpectedly broken and unable to trivially fix:

```bash
git reset --hard
icm store -t improvements -c "failed: <short description> — unable to fix <X> after changing <Y>" -i high
```

Stop. Do not continue with this task.

### 9. Commit with bumpy

Run `add-change` skill to create bump file, then commit:

```bash
icm store -t improvements -c "done: <short description>" -i medium
git add -A
git commit
```

### 10. PR to wip

Push branch and create PR targeting `wip`:

```bash
git push -u origin self-improvement/<short-description>
gh pr create --base wip --title "improve: <short description>" --body "Summary of changes"
```

## Rules

- **ONE substantive change per run** — depth over breadth
- **ALWAYS use `vp`** for package management and scripts — never `npm`, `pnpm`, or `npx`. All commands: `vp install`, `vp check`, `vp test`, `vp build`, `vp dev`, etc.
- Never modify: `AGENTS.md`, `CLAUDE.md`, files under `.opencode/`
- Caveman output: no articles, filler, pleasantries. Keep technical substance.
- Use ICM to track all work (backlog, progress, failures)
- Run bumpy for every commit (no commits without bump files)
- If unable to complete, store summary in ICM for next agent to pick up
- **If no meaningful work found**: store summary in ICM and stop. Do not pad with trivial changes.

## Anti-patterns (avoid these)

- Adding sections to READMEs (already comprehensive)
- Tables, TOCs, migration guides (low value organizational changes)
- Multiple small changes across unrelated files
- "Improving" things that are already good enough
- Single-line changes that don't constitute meaningful work
- Generic utilities in sugar (deep merge, pick, omit, debounce) — solved by lodash/ramda
- Features unrelated to actor model state machines
- Test coverage for test coverage's sake — test actor model behavior, not implementation details
