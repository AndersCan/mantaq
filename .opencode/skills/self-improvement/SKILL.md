---
name: self-improvement
description: Orchestrate self-improvement loop. Find tasks, spawn worker agents, track progress, improve skill itself.
argument-hint: "[iteration_count] [depth]"
allowed-tools: Read Grep Glob Bash Edit Write Task
version: 2
---

# Self-Improvement Orchestrator

Caveman output everywhere. No exceptions. Orchestrator finds tasks and coordinates workers.

## Context Management (Low Context Priority)

Orchestrator runs on low context. Every token counts. Rules non-negotiable:

1. **Never read files directly.** Use explore agents for ALL discovery.
2. **Never run rg/grep yourself.** Delegate to explore agents.
3. **Never carry file contents between iterations.** Workers read fresh.
4. **Agents return summaries, not dumps.** "3 TODOs in auth.ts:142,187,201" not full file.
5. **Batch exploration.** One explore agent finds all tasks, not separate agent per file.
6. **Workers do own exploration.** Don't pre-read files for them.
7. **Log only hashes and one-liners.** No file contents in logs.
8. **Skip retrospectives that re-read files.** Recall from logs only.

## Caveman Requirements

ALL output from this skill MUST follow caveman grammar. See [AGENTS.md](../../AGENTS.md) for full rules.

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

Every PR created must have auto-merge enabled: `gh pr merge $PR --auto --merge`

## Core Loop

### Phase 0: Setup

```
rtk git checkout wip && rtk git pull
git checkout -b self-improvement/<short-description>
```

> See [`rtk` command](../command/rtk.md) for docs.

Set DESC variable:

```
DESC="<short-description>"
```

Read this SKILL.md fully before starting.

Branch created once. All iterations commit to same branch. No new branches per iteration.

### Phase 1: Discover & Plan (AGENT-DRIVEN)

**Do NOT run rg/grep directly.** Spawn explore agents. Orchestrator stays lean.

**Step 1a: Spawn single explore agent for full discovery**

```
Task(
  subagent_type: "explore",
  description: "Discover self-improvement tasks",
  prompt: "Scan codebase for improvement tasks. Return ONLY line-list summary. No file contents.

DEPTH: <shallow|medium|deep>

SHALLOW searches:
- rg 'TODO|FIXME|HACK|XXX|BUG|WORKAROUND' packages/ --include '*.ts' --include '*.md'
- rg 'as any|as unknown|@ts-expect|@ts-ignore' packages/ --include '*.ts'

MEDIUM adds:
- rg 'describe\(|test\(|it\(' packages/ --include '*.test.ts'
- rg 'export (const|function|class|interface|type)' packages/ --include '*.ts'

DEEP adds:
- gh issue list --limit 20
- git log --oneline --grep='self-improvement' -30

RETURN FORMAT (one line per finding):
<file>:<line> | <type: TODO|FIXME|HACK|TYPE_ISSUE|TEST_GAP|EXPORT> | <one-line description>

Do NOT return file contents. Do NOT return full error messages. Line references only."
)
```

**Step 1b: Build DAG from agent summary**

Orchestrator parses agent output. Rank tasks:

1. Bug fixes (highest — no dependency)
2. Type safety fixes (depend on bug fixes)
3. Missing exports / barrel cleanup (independent)
4. Test coverage for uncovered behavior (depends on types)
5. DX improvements / new tests (lowest)

**Batch small cuts.** Multiple tasks removing <30 lines each → combine single iteration.

**Skip trivial worker spawning.** If ALL discovered tasks are <10 line edits (frontmatter, descriptions, links), do them directly in orchestrator. Not worth agent overhead.

**Verify before flagging.** Explore agents: check path existence before flagging as issue. `packages/` existing ≠ problem.

**Skip** (not real improvements):

- Generic utilities (deep merge, pick, omit, debounce)
- README/organizational changes
- Single-line trivial changes
- Features unrelated to actor model
- Test coverage for coverage sake

### Phase 2: Execute (iteration_count iterations)

For each task in DAG order:

**Step 2a. Spawn Worker**

Worker does own exploration. Don't pre-read for it.

```
Task(
  subagent_type: "general",
  description: "Self-improvement: <short-description>",
  prompt: "TASK: <task description from DAG>

TYPE: <bug fix|type safety|test coverage|export cleanup|dx improvement>
BRANCH: self-improvement/<DESC>

You are on branch self-improvement/<DESC>. Do NOT create new branches.
Work on current branch. Commit directly.

READ ONLY WHAT YOU NEED. Low context environment.
- Use grep/glob to find relevant code
- Read minimal snippets around target
- Don't read entire files unless necessary
- Carry context forward only what matters

Implement this change following [self-improvement-worker](../self-improvement-worker/SKILL.md) skill instructions.
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

MANDATORY. Do this every run. Analyze from logs only. Don't re-read files.

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
- [ ] Context usage — where biggest tokens spent?
- [ ] Were explore agent findings accurate or false positives?

Then edit SKILL.md with concrete improvements. Commit to same branch.

### Phase 4: Create PR

Single PR with everything — code changes + skill improvement:

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
- **Orchestrator running rg/grep** — delegate to explore agents
- **Reading full files in orchestrator** — agents return line refs only
- **Carrying file contents between iterations** — workers read fresh
- **Returning full file contents from agents** — summaries only
- **Spawning workers for trivial edits** — if all tasks <10 lines, do directly

## Orchestration Tips

- Check tooling before starting (bumpy, rtk, etc.) — skip steps that require missing tools. If bumpy unavailable, write `.bumpy/<name>.md` files manually.
- One branch per orchestration run. All iterations stack commits on it.
- Parallelism: independent tasks can share a branch
- Don't add features in one run and test them in another — keep related work together
- Pre-existing check errors (tsconfig, etc.) are noise — only fail on NEW errors your changes introduced
- **Batch same-pattern fixes.** If 3 files have identical issue (e.g. hardcoded colors), spawn single worker for all 3. Less overhead, consistent fix.
- **Identify test framework first.** Before spawning test workers, check package.json for vitest/jest. Include in worker prompt.
- **Pre-existing TS errors.** Workers may need `--no-verify` for commits if repo has pre-existing type errors. Document in worker prompt.
- **Parallel worker timing.** Parallel workers may report same commit hash if commits happen simultaneously. Stagger or verify with `git log`.
- **File-level isolation for parallel workers.** When spawning many parallel workers on same branch, give each worker a distinct file scope. Workers modifying same file (e.g. store) create merge conflicts and broken intermediate states. Pre-assign: "Worker A edits only actor-graph.ts, Worker B edits only state-node.ts".
- **Dead code detection before conversion.** Check if component is actually used before converting. Worker spent 10 iterations on minimap.ts only for another worker to delete it as dead code. Quick grep for `import.*minimap` or `customElements.get("minimap")` saves cycles.
- **Prefer lit-html over innerHTML.** Workers default to `el.innerHTML` to avoid lit dependency, but lit-html `html` templates are safer (no XSS, better diffing). Specify in worker prompt: "Use `html` from lit, NOT innerHTML string concatenation".
- **Batch commit at end, not per-iteration.** For high-parallelism runs (10+ workers), per-iteration commits create 50+ commit noise. Consider having workers batch their changes and make 1-2 commits each, or use a single final commit per worker.
- **Conflict-prone patterns to avoid in parallel workers:** (1) modifying same store file, (2) changing barrel exports, (3) deleting files other worker might reference, (4) modifying shared types. Assign these to single worker or serialize.
