---
name: ralph
description: Ralph Wiggum loop. Deep structural improvement. Core first. Refactors and simplifies — good abstractions make bugs impossible. Expensive model thinks, @worker executes. Splits long functions, kills multi-responsibility classes, reduces branching, kills type casts, improves DX via sugar, leaves FIXMEs for next run, self-reflects and improves own prompt at end. Use when user wants run self-improvement loop for deep work.
allowed-tools: Read Grep Glob Bash Edit Write Task
---

# Ralph Wiggum Loop

Expensive model thinks. Fast model executes.

@worker not dumb. Very fast. Delegate more than you think. Only keep reasoning-heavy work in orchestrator.

Caveman output everywhere. No exceptions. See [AGENTS.md](../../AGENTS.md).

- Commit messages, PR titles, summaries — ALL caveman
- Code blocks unchanged. Caveman speak around code, not in code

## North Star

Core first. `packages/core` is the target. Sugar/traversal/utils secondary. Examples = evidence.

Goal: bugs impossible. Not fewer bugs — impossible. Refactor, simplify, build good abstractions.

- **Types are correctness** — "if it typechecks, it runs correct". Push invariants into types (discriminated unions, narrowing, branded types, sealed constructors). Invalid states unrepresentable.
- **Compiler is oracle** — never silence it. Casts = design failure. Refactor, don't cast.
- **Simplify** — smallest design that satisfies the type. Every line is a potential bug.
- **Deterministic** — same input, same trace. No wall clock, no randomness (see `vision.md`).

## Parameters

- `iteration_count`: default 5 (deep work, slow)

## Time Limit

30 min max per run. Stop, commit partial if near limit.

## Codebase Ownership

Codebase owned by THIS loop. Core first — `packages/core` is the target; sugar/traversal/utils secondary; examples only as DX evidence. Only self-discovered, self-fixable work. No external features. No user requests. No trivial docs (other loops handle).

Backlog = FIXMEs in code. Loop finds FIXME → fixes. Finds issue, no time → leaves FIXME for next run. Self-perpetuating.

FIXME = loop's own marker. Use `// FIXME:` not `// TODO:` when leaving new ones.

FIXME must be SPECIFIC. Next run acts without re-investigation. Good: `// FIXME: splitUserParser handles validation + transformation — extract validator`. Bad: `// FIXME: refactor this`.

## Deep Work Focus

NOT trivial docs. NOT single-line tweaks. Deep structural work. Core first.

1. **Good abstractions — make bugs impossible** — invalid states unrepresentable. Discriminated unions, narrowing, branded types, indexed access, sealed constructors. No defensive checks where types guarantee. No repeated invariants enforced in two places — design makes them impossible. Highest value work.
2. **Simplify** — smallest design that satisfies the type. Less code, fewer branches, fewer moving parts. Simplest correct > clever.
3. **Split long functions** — >50 lines or many branches → split into named helpers. One job per function.
4. **Split multi-responsibility classes/functions** — one responsibility per unit. Extract. Move to own file if big.
5. **Reduce branching** — if/else chains → early returns, guard clauses, lookup tables, polymorphism. Kill nested conditionals >3 levels.
6. **Type safety** — kill `as unknown as X`, `as any`, `@ts-ignore`. Exception: TS limitation (setTimeout, branded types, lib gaps) → keep + explanatory comment.
7. **LOC reduction** — dedup, dead code, verbose patterns replaceable with stdlib.
8. **DX via sugar** — inspect `examples/` for painful/verbose patterns. Fix with existing sugar. No sugar for it? Flag need for new sugar helper. Can a core feature move to sugar for better DX? Prefer sugar over raw core in examples. Sugar = ergonomic layer over core.
9. **Leave FIXMEs** — found but not fixed this run → `// FIXME: <specific desc>` at location. Seeds next run.

Skip:

- README/doc updates (other loops handle)
- Single-line desc changes
- Features unrelated to existing code
- Generic utils not used
- Test coverage for coverage sake
- Barrel re-exports (user prefers multiple export files)
- Non-core polish when core work pending — core first
- Defensive runtime assertions that duplicate type guarantees — redesign, don't assert

## Core Rule

ONE branch across ALL runs. `ralph/improvements`. Create once from main. Continue forever. No new branches per run.

No per-loop PR. Push branch. User merges when ready.

Last task every run: improve this skill. Commit to same branch. Non-negotiable. No exceptions.

## Core Loop

### Phase 0: Setup

```
git fetch origin
git checkout ralph/improvements || git checkout -b ralph/improvements main
git pull origin ralph/improvements || true
```

Branch persists across runs. No new branches.

Optional rebase on main (stay fresh). Skip if conflicts:

```
git rebase main || git rebase --abort
```

### Phase 1: Discover (AGENT-DRIVEN)

Do NOT run rg/grep yourself. Spawn worker. Orchestrator stays lean. (worker handles discovery fine. skip explore agent.)

Step 1a: Spawn single worker for full discovery.

```
Task(
  subagent_type: "worker",
  description: "Ralph: discover deep work",
  prompt: "DISCOVERY ONLY. Do NOT edit/commit anything. Scan codebase for deep improvement work. Core first — packages/core/src highest value, sugar/traversal/utils secondary. Return ONLY line-list summary. No file contents.

PRIORITY 1 — existing FIXMEs (loop's backlog, highest):
- rg '// FIXME:' packages/ apps/ --include '*.ts' --include '*.tsx'
- rg '// TODO:' packages/ apps/ --include '*.ts' --include '*.tsx'
- Hindsight confirmed loop closes prior-run FIXMEs at high rate. Prioritize these ONE per iteration until cleared before touching PRIORITY 2. Each closed FIXME = self-perpetuation proof.

PRIORITY 2 — core refactor candidates (packages/core/src only):
- Long functions: rg -l '' packages/core/src --include '*.ts' | xargs wc -l | sort -rn | head -30. For each file, find functions >50 lines. Flag.
- Multi-responsibility classes: rg 'class ' packages/core/src --include '*.ts'. Flag classes with >5 methods or mixed concerns.
- Multi-responsibility functions: function name suggests multiple verbs (e.g. parseAndValidate, loadAndSave). Flag.
- Complex branching: rg 'else if|else \{' packages/core/src --include '*.ts'. Flag files with dense else chains (>3 else if).
- Nested conditionals: find 3+ level nesting in core. Flag.
- Defensive checks: rg 'if (!|if (=== undefined|null|throw' packages/core/src — flag runtime guards that types could guarantee. Invalid states should be unrepresentable, not asserted against.

PRIORITY 3 — abstraction candidates (make bugs impossible):
- Repeated invariants enforced in multiple places → one type/abstraction should own it.
- Nullable fields that never legitimately null → narrow the type, kill the branch.
- Unions without discriminant → add one.
- Same state-shape checked at N call sites → design so impossible.

PRIORITY 4 — type safety:
- rg 'as any|as unknown as' packages/ apps/ --include '*.ts' --include '*.tsx'
- rg '@ts-expect|@ts-ignore' packages/ apps/ --include '*.ts' --include '*.tsx'
- Core escapes outrank sugar escapes.

PRIORITY 5 — LOC reduction:
- Dead exports: rg 'export (const|function|class)' packages/ --include '*.ts'. For each, check import usage elsewhere. Flag unused.
- Duplication: repeated 5+ line blocks across files.

PRIORITY 6 — DX via sugar (secondary):
- Inspect examples/ — find verbose/painful usage patterns. Flag spots where sugar could help.
- For each pain point: check if existing sugar covers it. If yes → examples should use sugar, flag for sugar adoption. If no → flag 'NEW SUGAR NEEDED: <desc>'.
- Core feature used heavily in examples but ergonomic only via sugar? Flag 'MOVE TO SUGAR: <feature>'.
- rg 'import.*@mantaq/core' examples/ — direct core usage in examples. Flag each as sugar opportunity.

PRIORITY 7 — freshness:
- git log --oneline --grep='ralph' -30 — avoid repeating past tasks

RETURN FORMAT (one line per finding):
<file>:<line> | <priority: FIXME|CORE|ABSTRACTION|TYPE|LOC|DX> | <category: SPLIT|RESPONSIBILITY|BRANCHING|NESTING|DEFENSIVE|INVARIANT|CAST|DEAD|DUP|SUGAR-ADOPT|NEW-SUGAR|MOVE-TO-SUGAR> | <one-line specific description>

Skip trivial findings (<10 line edits, doc tweaks, single-line renames). No file contents. Line refs only.
Verify path exists before flagging."
)
```

Step 1b: Build DAG. Orchestrator parses. Rank:

1. Existing FIXMEs (highest — loop's own backlog)
2. Core refactors — splits, branching, nesting (packages/core first)
3. Abstraction wins — make bugs impossible (DEFENSIVE/INVARIANT)
4. Type safety (casts, escapes)
5. LOC reduction (dead code, dedup)
6. DX via sugar (examples pain → existing sugar / new sugar / move core to sugar)

Batch small cuts in same file → single worker.

Skip trivial. Verify path exists before flagging.

### Phase 2: Execute (iteration_count iterations)

For each task in DAG order:

Step 2a: Pick executor.

@worker not dumb. Very fast. Delegate aggressively. Only keep true reasoning in orchestrator.

**Orchestrator-only (needs deep reasoning):**

- API design (naming, public surface, error types)
- Bug root-causing across files
- Architecture decisions (new module? new sugar helper? move core to sugar? new package?)
- Designing new sugar API surface (sugar = ergonomic layer, design matters)

**Delegate to @worker (fast, handles more than you think):**

- Function splits — spec: target file + line + suggested helper names + what stays vs moves
- Class/function responsibility splits — spec: what extracts + target file + new name
- Branching refactors — spec: replacement pattern (early return / lookup table / guard clauses)
- Update callers after any refactor
- Fix tests after refactor
- Dead code deletion (grep confirmed unused)
- Type cast removal (pattern verified, not TS limitation)
- Import cleanup
- Format/lint fixes
- Sugar adoption in examples (swap raw core import for sugar import)
- New sugar helper — spec: signature + behavior + test cases. Worker implements, exports, tests.
- JSDoc addition to existing stable exports

Default: delegate. Only keep when worker would guess wrong on design.

Step 2b: Spawn @worker.

```
Task(
  subagent_type: "worker",
  description: "Ralph: <short-desc>",
  prompt: "TASK: <desc>
CATEGORY: <SPLIT|RESPONSIBILITY|BRANCHING|ABSTRACTION|TYPE|LOC|DX|CLEANUP>
BRANCH: ralph/improvements (git checkout ralph/improvements first)

READ ONLY WHAT YOU NEED. Low context.
- grep/glob to find code
- Read minimal snippets around target
- Don't read entire files unless necessary
- Carry forward only what matters

RULES:
- No code comments unless explaining non-obvious TS limitation
- Strict type safety — no new 'as any' or 'as unknown as'
- Follow existing conventions
- Before deleting: grep imports. Confirm unused.
- If touching public API: check callers across packages
- Found issue but not fixing this task? Leave '// FIXME: <specific desc>' at location
- New sugar helper? Add to packages/sugar/src/, export from index.ts, add test in packages/sugar/tests/

CHECK before commit:
- vp check --fix
- vp run guard (north star gates: type escapes, export budget, determinism)
- vp test --reporter agent (if tests for touched area)
- Max 3 fix attempts. Still failing → return failure.

COMMIT:
- git add -A
- git commit -m 'improve: <short-desc>'
- Do NOT push. Do NOT create PR.

Return: success/failure, commit hash, error if failed, brief changes desc."
)
```

Step 2c: Orchestrator does reasoning-heavy directly.

1. Read target file (minimal snippet around target)
2. Design split/refactor (helpers, signatures, new files)
3. Edit file(s)
4. Update callers (or delegate to @worker)
5. `vp check --fix && vp test --reporter agent`
6. Commit: `git commit -m 'improve: <short-desc>'`

Step 2d: Track progress.

```
echo "<iter N>: <category> | <desc> | <commit hash>" >> /tmp/ralph-log.txt
```

Step 2e: Leave FIXMEs for found-but-not-fixed.

Found issue, no time this run? Add at location:

```
// FIXME: <specific desc>
```

Next run picks up. Non-negotiable: found-but-skipped MUST get FIXME.

Step 2f: Handle results.

- Worker success → log hash, continue
- Worker failure → log failure, continue
- Max iteration_count iterations
- Diversify categories across iterations

### Phase 3: Self-Reflect & Improve Loop

MANDATORY every run. Two parts. Non-negotiable.

**Part A: Run retrospect.** Logs only. No re-reading files.

Questions:

- Which tasks succeeded? Failed?
- @worker handle tasks well? Was task too complex, or prompt bad?
- Did orchestrator do too much itself?
- Which categories fail most?
- FIXMEs added vs fixed ratio? Backlog growing or shrinking?
- iteration_count right? (5 enough? too many for 30min?)
- Context usage — biggest tokens spent?
- Explore findings accurate? False positives?
- Deep work quality — real structural improvement or surface tweaks?
- Justified type casts flagged as false positives?
- DX/sugar findings — real pain or imagined? Examples actually improved?
- Worker speed — felt slow anywhere? Where?

**Part B: Improve this SKILL.md.** Loop's own prompt is loop's most important code. Fix it.

Apply concrete fixes based on Part A:

- Worker failed task type repeatedly → clarify prompt for that category, or move to orchestrator-only list
- False positives from worker discovery → tighten search criteria
- Worker too slow on X → add "do directly" rule for X
- Worker guessed wrong on Y → add spec detail to worker prompt template
- Category never picked → demote or remove
- FIXME backlog growing → raise iteration_count or narrow scope
- Context waste → cut prose, tighten prompts
- New failure mode discovered → add to anti-patterns or orchestration tips
- Skill prose not caveman → fix it

Edit SKILL.md directly. Commit:

```
git add .opencode/skills/ralph/SKILL.md
git commit -m 'improve: ralph skill - <what changed>'
```

Skill improvement counts as final iteration. Non-negotiable. No exceptions.

### Phase 4: Push

```
git push origin ralph/improvements
```

No PR. User merges when ready.

Print summary of commits this run:

```
git log --oneline -<iteration_count*2>
```

## Anti-patterns

- Creating new branches per run — ONE branch. Persist.
- PR per loop — no. Push branch. User merges.
- README/doc updates — other loops handle.
- Single-line tweaks not real work.
- Features unrelated to quality.
- Generic utils not used.
- Test coverage for coverage sake.
- Manual PR review — trust CI.
- Bumpy files per iteration — batch at end.
- Re-reading files from previous iterations — carry forward.
- Repeating same category consecutively — diversify.
- Padding with trivial tasks when real work runs out — stop early, be honest.
- Orchestrator running rg/grep — delegate to worker.
- Reading full files in orchestrator — line refs only.
- Spawning workers for trivial edits — do directly.
- Worker editing files outside task FILES list — workers MUST stay scoped. Out-of-scope file needs work → leave FIXME at location, do NOT edit. Orchestrator assigns separate task. Parallel workers stay file-disjoint.
- Delegating reasoning to @worker — worker handles more than you think. Only keep API design, architecture, cross-file bug root-causing in orchestrator.
- Force-removing justified type casts — TS limitations keep + comment.
- Skipping FIXME deposition — found-but-not-fixed MUST leave FIXME. Self-perpetuating loop breaks otherwise.
- Vague FIXMEs — `// FIXME: refactor this` useless. Be specific.

## Orchestration Tips

- Check tooling (vp, bumpy) — skip missing. If bumpy unavailable, write `.bumpy/<name>.md` manually.
- One branch. All runs stack commits.
- Parallel workers: file-level ownership. No overlap.
- Shared files (index.ts, shared types) → one worker owns.
- Pre-existing check errors = noise. Only fail on NEW errors your changes introduced.
- Batch same-pattern fixes. 3 files same `as any` → one worker.
- Identify test framework first. Check package.json. Include in worker prompt.
- Pre-existing TS errors → workers may need `--no-verify`.
- Parallel workers may report same hash if simultaneous commits. Verify with `git log`.
- Dead code: grep imports before deleting. `rg 'import.*<symbol>'`.
- Batch commit at end for high parallelism. 1-2 commits per worker, not per file.
- Conflict-prone: same file, barrel exports, deleting referenced files, shared types. Serialize.
- Pre-commit hook false positives (errors in OTHER files not staged) → `--no-verify`. Verify with `vp test --run` first.
- Cross-worker lint errors → fix unused imports/vars or `--no-verify`.
- Test imports drift → run `vp check` before commit. Catches `TS6133`.
- Justified type casts (`setTimeout` returning `NodeJS.Timeout`, branded primitives, lib gaps) → keep + comment. Check before flagging.

## Handling Merge Conflicts

### Prevention

1. File-level ownership. Each worker distinct scope.
2. Shared files: one owner.
3. Serialize shared-file changes.

### Detection

```bash
git diff --name-only | sort
# Two workers modified same file → serialize. One commits, other rebases.
```

### Resolution

1. Worker detects CONFLICT on commit.
2. `git pull --rebase origin ralph/improvements`
3. Resolve in OWN files only. Don't touch other worker's code.
4. `git rebase --continue`
5. Unresolvable → return failure. Orchestrator serializes.

### Post-Merge Check

After all workers: `vp check` on branch. If conflicts:

1. `git stash`
2. `git pull --rebase`
3. Fix conflicts
4. `git stash pop`
5. `vp test --run`

## Batching Related Work

Batch = less overhead, consistent fix.

### Batch Criteria

ALL true:

- Same file type
- Same change pattern
- <50 lines each
- No dependency between changes

### Good Batches

| Batch                                   | Scope         | Reason                    |
| --------------------------------------- | ------------- | ------------------------- |
| Remove `as any` in 5 files              | Single worker | Same pattern, mechanical  |
| Delete 8 unused exports                 | Single worker | Mechanical, pure LOC win  |
| Fix 6 callers after function split      | Single worker | Follow-up, mechanical     |
| Replace `as unknown as X` with generics | Single worker | Type safety, same pattern |

### Bad Batches (Serialize)

| Batch                                | Reason                                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| Refactor store + update 5 callers    | Callers depend on new signature — worker can do both if spec clear   |
| Split class + update tests           | Worker can do both if spec clear — split + test update in one task   |
| Redesign API + update docs           | API design needs reasoning — orchestrator                            |
| New sugar helper + adopt in examples | Helper must exist first — serialize, or worker does both in one task |

### Worker Prompt Template (Batched)

```
TASK: Remove all 'as any' in sugar package
CATEGORY: TYPE
FILES: file-a.ts, file-b.ts, file-c.ts

For EACH file:
1. Read
2. Find 'as any'
3. Replace with proper generic or type guard
4. TS limitation? Keep + explanatory comment
5. vp check --fix on file
6. Do NOT commit yet

After ALL files:
1. vp check on package
2. vp test --run
3. Single commit: "improve: kill as-any in sugar"
```

### Orchestrator Batching Strategy

1. Group by pattern. Scan tasks, group identical.
2. Check file count. >8 files → split into 2 workers.
3. Check dependencies. Any task depends on another's output → serialize.
4. Assign to single worker with explicit file list.
5. Single commit per batch. Not per file.
