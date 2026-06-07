---
name: self-improvement
description: Run 10 improvement iterations on codebase, then analyze and improve the loop itself. Single-session, DAG-ordered, auto-merge.
---

# Self-Improvement Meta-Skill

Caveman output everywhere except code. Agent runs 10 improvement iterations, then improves the skill itself.

## Branching

- Branch from `wip` (integration branch)
- All codebase PRs target `wip`
- Branch naming: `self-improvement/<short-description>`
- Skill improvement committed on same branch as final iteration

## Time Limit

- **30 minutes max** per skill run (10 iterations)
- Stop and commit partial work if approaching limit

## Core Loop

### Phase 0: Setup

```
rtk git checkout wip && rtk git pull
```

Read this SKILL.md fully before starting.

### Phase 1: Discover & Plan (before any implementation)

Build complete task inventory:

```
# Find all TODOs/FIXMEs
rg "TODO|FIXME|HACK|XXX|BUG|WORKAROUND" packages/ --include "*.ts" --include "*.md"

# Find all type safety issues
rg "as any|as unknown|@ts-expect|@ts-ignore" packages/ --include "*.ts"

# Find test gaps — grep test files for patterns not covered
rg "describe\(|test\(|it\(" packages/ --include "*.test.ts"

# Find dead exports / unused code
rg "export (const|function|class|interface|type)" packages/ --include "*.ts"

# Find missing barrel exports
rg "^export .* from " packages/ --include "*.ts" | sort
rg "^export type" packages/ --include "*.ts" | sort

# Check GitHub issues
gh issue list --limit 20

# Review recent work
git log --oneline --grep="self-improvement" -30
```

**Build DAG** — rank tasks by dependency:

1. Bug fixes (highest priority — no dependency on other improvements)
2. Type safety fixes (depend only on bug fixes)
3. Missing exports / barrel cleanup (independent)
4. Test coverage for uncovered behavior (depends on types being correct)
5. DX improvements / new tests (lowest priority)

**Skip** (not real improvements):

- Generic utilities (deep merge, pick, omit, debounce)
- README/organizational changes
- Single-line trivial changes
- Features unrelated to actor model
- Test coverage for coverage sake

### Phase 2: Execute (10 iterations)

For each task in DAG order (up to 10):

**Step 2a. Branch**

```
git checkout wip
git pull
git checkout -b self-improvement/<short-description>
```

**Step 2b. Implement**

- ONE substantive change per iteration
- No code comments
- Maintain strict type safety

**Step 2c. Check**

```
vp check && vp test --reporter agent
```

- If pass → proceed
- If fail → max 3 fix attempts. If still failing after 3 → abandon task, note in summary, move to next task. Do NOT reset — the abandoned branch holds the failure record.

**Step 2d. Auto-merge**

```
git add -A
# Run add-change skill for bumpy, but batch: only create bumpy file if this is the LAST codebase iteration
git commit -m "improve: <short description>"
git push -u origin self-improvement/<short-description>
gh pr create --base wip --title "improve: <short description>" --body "Summary of changes"
```

Wait for PR CI. Check PR status:

```
gh pr checks <number> --watch --interval 10
```

If all checks pass → auto-merge:

```
gh pr merge <number> --merge
```

If checks fail → max 2 fix commits. If still failing → close PR, skip task.

**Track progress** — store summary after each iteration:

```
echo "<iteration N>: <task> — <status>" >> /tmp/self-improvement-log.txt
```

### Phase 3: Retrospect & Improve Skill

After 10 iterations (or all available tasks completed), analyze:

1. Read the log: `cat /tmp/self-improvement-log.txt`
2. Calculate: success rate, avg time per iteration, most common failure reasons
3. Identify 3 concrete improvements to this SKILL.md:

**Checklist for skill improvement:**

- [ ] Were instructions clear enough that you didn't need to re-read?
- [ ] Did task ranking produce correct dependency order?
- [ ] Where did you waste most time? (check failures? re-reading files? etc)
- [ ] Was auto-merge reliable? Any merge conflicts?
- [ ] Did you have to re-scan codebase between iterations?
- [ ] What would make next run 20% faster?

Update SKILL.md with fixes. Target concrete text changes, not vague promises.

### Phase 4: Commit Skill Improvement

```
git checkout wip
git pull
git checkout -b self-improvement/improve-loop
git add .opencode/skills/self-improvement/SKILL.md
git commit -m "improve: self-improvement loop — <concrete improvement>"
git push -u origin self-improvement/improve-loop
gh pr create --base wip --title "improve: self-improvement loop" --body "## Changes\n- <list concrete skill changes>\n## Rationale\n- <why each change improves the loop>\n## Observed issues fixed\n- <issue numbers from pain points>"
```

## Anti-patterns (avoid these)

- Adding sections to READMEs
- Multiple small changes across unrelated files
- "Improving" things already good enough
- Single-line changes not constituting meaningful work
- Generic utilities in sugar
- Features unrelated to actor model state machines
- Test coverage for test coverage's sake
- Branching per skill improvement — must be on same branch as codebase work
- Manual review of working PRs — trust CI, auto-merge
- Creating bumpy files per iteration — batch at end
- Stopping to read files already read in previous iterations — carry forward
- Repeating same task type in consecutive iterations — diversify
- Padding with trivial tasks when real work runs out — stop early, be honest
