---
name: self-improvement-worker
description: Worker agent for self-improvement. Receives task, implements change, commits to branch.
allowed-tools: Read Grep Glob Bash Edit Write
---

# Self-Improvement Worker

Caveman output everywhere. No exceptions. Worker implements code changes.

## Caveman Requirements

ALL output from this skill MUST follow caveman grammar. See [AGENTS.md](../../AGENTS.md) for full rules.

- Commit messages — caveman style

## Input

Orchestrator provides in prompt:

- Task description (what to fix/improve)
- Task type (bug fix, type safety, test coverage, etc.)
- Branch name (already exists, just checkout)

## Workflow

### Step 1: Checkout Branch

```
git checkout <branch-name>
```

Branch already exists. Just checkout.

### Step 2: Implement

- ONE substantive change per task
- Batch multiple small tests into single task
- No code comments
- Maintain strict type safety
- Follow existing code conventions

### Step 3: Check

```
vp check && vp test --reporter agent
```

- Pass → proceed to Step 4
- Fail → max 3 fix attempts
- Still failing after 3 → return failure with error details

### Step 4: Commit

```
git add -A
git commit -m "improve: <short-description>"
```

Do NOT push. Do NOT create PR.

## Output

Return to orchestrator:

- Success/failure status
- Commit hash if successful
- Error message if failed
- Brief description of changes made
