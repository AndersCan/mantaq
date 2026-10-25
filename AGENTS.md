# Caveman Mode

Terse. Drop articles, filler, pleasantries, hedging. Fragments ok. Short synonyms (big not extensive). Technical terms exact. Code blocks unchanged. Error messages quoted exact.

Pattern: `[thing] [action] [reason]. [next step].`

Bad: "Sure! I'd be happy to help. The issue is likely caused by..."
Good: "Bug in auth middleware. Token expiry check uses `<` not `<=`. Fix:"

## Starting Work

Branch from `origin/main`, never local `main` (goes stale: deleted files, old APIs, dead branches).

```
git fetch origin
git checkout -b <branch> origin/main
```

Before touching anything:

- `git rev-parse main origin/main` differs → local main stale. Fix: `git reset --hard origin/main` or branch from `origin/main`.
- `git log main..origin/main --oneline` has output → local main behind.
- Merged PRs reach you only via `origin/main`. Fetch first.

Rules:

1. Branch off `origin/main`.
2. No edits on a base older than `origin/main`.
3. `origin/main` advances mid-task → rebase, or redo work on new base.
4. Stale local main: `git branch -m main main-stale`.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

<!--SKILLS START-->

# Test Taxonomy

Split by filename. The split is **what survives a refactor**, not what it tests:

| Suffix               | Purpose                                                      | Stryker? | Refactor story                 |
| -------------------- | ------------------------------------------------------------ | -------- | ------------------------------ |
| `*.test.ts`          | features, happy paths                                        | no       | stable, hand-edited            |
| `*.error.test.ts`    | failure paths: `Left`, warnings, budget, abort, unregistered | no       | stable, hand-edited            |
| `*.property.test.ts` | PBT invariants vs reference model                            | **yes**  | regenerable, broad not precise |
| `*.mutation.test.ts` | directed tests for stubborn surviving mutants                | **yes**  | throw away, recreate           |

Property tests = quantitative engine. fast-check uses pinned seed (`MANTAQ_SEED` env overrides; default in `@mantaq/pbt`), so runs replay identically. Shared generators + `runProperty` live in `@mantaq/pbt` (`anyName`, `anyDuration`, `anyActorSnapshot`, ...).

## Refactor workflow

1. Refactor impl. `vp test` = feature + error + property (fast qualitative gate).
2. `stryker run` = property + mutation tests only (config `testFiles`).
3. Score below break → delete `*.mutation.test.ts`, re-run, tighten generators or add one directed test per surviving mutant.
4. Never edit feature/error tests to kill mutants.

## Thresholds

Stryker break: core 89.5 (root `stryker.config.json`, virtual-clock excluded), sugar 90 (`packages/sugar/stryker.config.json`). Low 92, high 95 both.

<!--TEST TAXONOMY END-->

<!--VISION ENFORCEMENT START-->

# North Star Enforcement

`vision.md`: _"If it typechecks, it runs correct"_, _"If it runs, it runs deterministic"_, _"Forcing the compiler quiet = wrong path."_

Machine checks, not taste. Harness is the oracle. Four gates:

1. **No type escapes in `packages/core/src`**: `as any`, `as unknown as`, `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck` fail `vp run guard`. `typescript/no-explicit-any` = error repo-wide. No `throw` in library src (`mantaq/no-throw`: core/sugar/traversal/test). Errors = values (Either).
2. **Export budget**: `packages/core/src/index.ts` capped (`scripts/vision-guard.mjs`). No public `Internal*` except allowlist (`InternalEvent` = public event contract).
3. **Impl size ceiling**: `packages/core/src` capped per file and total. Growth fails → "reduce complexity" has gradient.
4. **Determinism**: no `Date.now`, `Math.random`, `performance.now` in core runtime. Only `real-clock.ts` reads wall clock. Same inputs → same trace.

Type-level tests: `packages/core/src/typecheck.test.ts` (`expectTypeOf` + `@ts-expect-error`). Wrong usage fails `vp check`. Runtime tests and type oracle = same file.

## Review Checklist

- [ ] `vp check`: format, lint, types, incl. type-level assertions.
- [ ] `vp run guard`: north star gates (part of `vp run ready`).
- [ ] Never silence compiler. Needs `as any` / `as unknown as` / `@ts-*` → design wrong. Refactor.
- [ ] `@mantaq/core` stays small. New exports and impl lines cost budget; measure first.
- [ ] `vp run mutation:core` + `vp run mutation:sugar`: score ≥ break (89.5 core, 90 sugar).

<!--VISION ENFORCEMENT END-->

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`AndersCan/mantaq`) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
