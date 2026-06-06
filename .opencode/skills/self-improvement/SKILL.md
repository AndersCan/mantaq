---
name: self-improvement
description: Substantial continuous improvements (3-5+ related edits per run): tests, docs, bug fixes, features, typing, code quality. Branch from wip, PR to wip, use ICM + bumpy.
---

# Self-Improvement Skill

Agent performs continuous improvements. Caveman output everywhere except code.

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

### 3. Branch

```bash
git checkout -b self-improvement/<short-description>
```

### 4. Implement

- **Substantial changes only**: Minimum 3-5 related edits across files per run. Avoid trivial single-line changes.
- Each run should complete a full logical unit of work (e.g., fully type a module, add a complete feature, fix a bug with tests)
- Scope: tests, docs, bug fixes, features, typing, code quality (reduce lines, maintain tests), DX improvements
- **DX improvements**: Find pain points, verbose code, clunky patterns. Prefer sugar package for solutions (core requires deeper understanding and more work)
- No comments in code
- Maintain strict type safety
- If backlog item is large, break into clear sub-tasks and do as many as time allows

### 5. Verify

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

### 6. Commit with bumpy

Run `add-change` skill to create bump file, then commit:

```bash
icm store -t improvements -c "done: <short description>" -i medium
git add -A
git commit
```

### 7. PR to wip

Push branch and create PR targeting `wip`:

```bash
git push -u origin self-improvement/<short-description>
gh pr create --base wip --title "improve: <short description>" --body "Summary of changes"
```

## Rules

- **ONE logical unit of work per run** (but that unit should be 3-5+ related edits, not single-line changes)
- **ALWAYS use `vp`** for package management and scripts — never `npm`, `pnpm`, or `npx`. All commands: `vp install`, `vp check`, `vp test`, `vp build`, `vp dev`, etc.
- Never modify: `AGENTS.md`, `CLAUDE.md`, files under `.opencode/`
- Caveman output: no articles, filler, pleasantries. Keep technical substance.
- Use ICM to track all work (backlog, progress, failures)
- Run bumpy for every commit (no commits without bump files)
- If unable to complete, store summary in ICM for next agent to pick up
- **Prefer depth over breadth**: Better to fully complete one meaningful task (with tests, docs, types) than to do multiple shallow fixes
