---
name: self-improvement
description: Orchestrate self-improvement loop. Find tasks, spawn worker agents, track progress, improve skill itself.
---

# Self-Improvement Orchestrator

Caveman output everywhere. No exceptions. Orchestrator finds tasks and coordinates workers.

## Caveman Requirements

ALL output from this skill MUST follow caveman grammar:

- Drop articles (a, an, the)
- Drop filler (just, really, basically, actually, simply)
- Drop pleasantries (sure, certainly, of course, happy to)
- Short synonyms (big not extensive, fix not "implement a solution for")
- No hedging (skip "it might be worth considering")
- Fragments fine. No need full sentence
- Technical terms stay exact. "Polymorphism" stays "polymorphism"
- Code blocks unchanged. Caveman speak around code, not in code
- Error messages quoted exact. Caveman only for explanation
- Commit messages, PR titles, PR bodies, summaries — ALL caveman

## Parameters

- `iteration_count`: Number of iterations (default 10)
- `depth`: Task discovery depth (`shallow`, `medium`, `deep`)

## Time Limit

- **30 minutes max** per skill run
- Stop and commit partial work if approaching limit

## Core Rule

**ONE PR per orchestration loop.** All iterations stack commits on same branch. Single PR at end. Never one PR per iteration.

Last task of every orchestration run: improve this skill and commit to same branch. Non-negotiable. No exceptions.

## Core Loop

### Phase 0: Setup

```
rtk git checkout wip && rtk git pull
git checkout -b self-improvement/<short-description>
```

Set DESC variable:

```
DESC="<short-description>"
```

Read this SKILL.md fully before starting.

Branch created once. All iterations commit to same branch. No new branches per iteration.

### Phase 1: Discover & Plan

Build task inventory based on depth:

**shallow:**

```
rg "TODO|FIXME|HACK|XXX|BUG|WORKAROUND" packages/ --include "*.ts" --include "*.md"
rg "as any|as unknown|@ts-expect|@ts-ignore" packages/ --include "*.ts"
```

**medium (adds):**

```
rg "describe\(|test\(|it\(" packages/ --include "*.test.ts"
rg "export (const|function|class|interface|type)" packages/ --include "*.ts"
rg "^export .* from " packages/ --include "*.ts" | sort
rg "^export type" packages/ --include "*.ts" | sort
```

**deep (adds):**

```
gh issue list --limit 20
git log --oneline --grep="self-improvement" -30
```

**Build DAG** — rank tasks by dependency:

1. Bug fixes (highest priority — no dependency)
2. Type safety fixes (depend only on bug fixes)
3. Missing exports / barrel cleanup (independent)
4. Test coverage for uncovered behavior (depends on types)
5. DX improvements / new tests (lowest priority)

**Skip** (not real improvements):

- Generic utilities (deep merge, pick, omit, debounce)
- README/organizational changes
- Single-line trivial changes
- Features unrelated to actor model
- Test coverage for coverage sake

### Phase 2: Execute (iteration_count iterations)

For each task in DAG order:

**Step 2a. Spawn Worker**

```
Task(
  subagent_type: "general",
  description: "Self-improvement: <short-description>",
  prompt: "TASK: <task description from DAG>

TYPE: <bug fix|type safety|test coverage|export cleanup|dx improvement>
BRANCH: self-improvement/<DESC>

You are on branch self-improvement/<DESC>. Do NOT create new branches.
Work on current branch. Commit directly.

Implement this change following self-improvement-worker skill instructions.
Return: success/failure, commit hash if successful, error if failed."
)
```

**Step 2b. Track Progress**

```
echo "<iteration N>: <description> | <commit hash>" >> /tmp/self-improvement-log.txt
```

**Step 2c. Handle Results**

- Worker returns success → log commit hash, continue
- Worker returns failure → log failure, continue
- Max iteration_count iterations total

### Phase 3: Retrospect & Improve Skill

MANDATORY. Do this every run. Analyze what happened:

1. Which tasks succeeded? Which failed?
2. What pain points emerged?
3. What would make next run faster/better?

**Questions to answer:**

- [ ] Worker spawning efficient?
- [ ] Any tasks that should be batched?
- [ ] Which task types fail most?
- [ ] Depth appropriate?
- [ ] iteration_count right?
- [ ] What would make next run 20% faster?

Then edit SKILL.md with concrete improvements. Commit to same branch.

### Phase 4: Create PR

ONE PR for entire loop. Push branch and create single PR:

```
git push -u origin self-improvement/$DESC
PR=$(gh pr create --base wip --title "improve: $DESC" --body "## Changes
$(cat /tmp/self-improvement-log.txt | sed 's/^/- /')
- Updated self-improvement SKILL.md
## Summary
- <iteration_count> iterations completed
- <N> successful, <M> failed" | tail -1)
echo "PR: $PR"
gh pr merge $PR --auto --merge
```

## Anti-patterns (avoid these)

- **Creating one PR per iteration** — ONE PR for entire loop. Stack commits.
- Adding sections to READMEs
- Multiple small changes across unrelated files
- "Improving" things already good enough
- Single-line changes not constituting meaningful work
- Generic utilities in sugar
- Features unrelated to actor model state machines
- Test coverage for test coverage's sake
- Manual review of working PRs — trust CI, auto-merge
- Creating bumpy files per iteration — batch at end
- Stopping to read files already read in previous iterations — carry forward
- Repeating same task type in consecutive iterations — diversify
- Padding with trivial tasks when real work runs out — stop early, be honest

## Orchestration Tips

- Check tooling before starting (bumpy, rtk, etc.) — skip steps that require missing tools
- One branch per orchestration run. All iterations stack commits on it.
- Parallelism: independent tasks can share a branch
- Don't add features in one run and test them in another — keep related work together
