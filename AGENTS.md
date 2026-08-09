# Caveman Mode

## Core Rule

Respond like smart caveman. Cut articles, filler, pleasantries. Keep all technical substance.

## Grammar

- Drop articles (a, an, the)
- Drop filler (just, really, basically, actually, simply)
- Drop pleasantries (sure, certainly, of course, happy to)
- Short synonyms (big not extensive, fix not "implement a solution for")
- No hedging (skip "it might be worth considering")
- Fragments fine. No need full sentence
- Technical terms stay exact. "Polymorphism" stays "polymorphism"
- Code blocks unchanged. Caveman speak around code, not in code
- Error messages quoted exact. Caveman only for explanation

## Pattern

```
[thing] [action] [reason]. [next step].
```

Not:

> Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by...

Yes:

> Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:

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

# Skills

Skills listed in system prompt `available_skills` may be stale. Load from disk:

- `.opencode/skills/add-change/SKILL.md`
- `.opencode/skills/find-skills/SKILL.md`
- `.opencode/skills/save-changes/SKILL.md`
- `.opencode/skills/self-improvement/SKILL.md`
- `.opencode/skills/self-improvement-worker/SKILL.md`

Use `skill` tool with name matching the directory. Disk versions supersede system prompt.

<!--SKILLS END-->

<!--TEST TAXONOMY START-->

# Test Taxonomy

Tests split by filename. The split is **what survives a refactor**, not what tests what:

| Suffix               | Purpose                                                      | Feeds stryker? | Refactor story                      |
| -------------------- | ------------------------------------------------------------ | -------------- | ----------------------------------- |
| `*.test.ts`          | features, happy paths                                        | no             | stable, hand-edited                 |
| `*.error.test.ts`    | failure paths: `Left`, warnings, budget, abort, unregistered | no             | stable, hand-edited                 |
| `*.property.test.ts` | PBT invariants against a reference model                     | **yes**        | regenerable, kept broad not precise |
| `*.mutation.test.ts` | directed tests for stubborn surviving mutants                | **yes**        | throw away and recreate             |

Property tests are the quantitative engine. fast-check runs them with a pinned seed
(`MANTAQ_SEED` env var overrides; default in `@mantaq/pbt`), so runs replay identically.
Shared generators and `runProperty` live in `@mantaq/pbt` (`anyName`, `anyDuration`,
`anyActorSnapshot`, ...).

## Refactor workflow

1. Refactor impl. `vp test` runs feature + error + property tests (fast qualitative gate).
2. `stryker run` runs only `*.property.test.ts` + `*.mutation.test.ts` (config `testFiles`).
3. Score below break? Throw away `*.mutation.test.ts`, re-run, tighten generators or add
   one directed test per surviving mutant.
4. Feature and error tests are never edited for mutant-killing.

## Thresholds

Stryker break is 90, low 92, high 95 (root `stryker.config.json`, `packages/sugar/stryker.config.json`).

<!--TEST TAXONOMY END-->

<!--VISION ENFORCEMENT START-->

# North Star Enforcement

`vision.md` says: _"If it typechecks, it runs correct"_, _"If it runs, it runs deterministic"_, and _"Forcing the compiler quiet = wrong path."_

Those are machine checks, not taste. The harness is the oracle. Four gates:

1. **Zero type escapes in `packages/core/src`** — `as any`, `as unknown as`, `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck` fail `vp run guard`. Plus `typescript/no-explicit-any` is an error repo-wide. No `throw` in library src either (`mantaq/no-throw` oxlint rule, core/sugar/traversal/test). Errors flow as values (Either), never exceptions.
2. **Export budget** — `packages/core/src/index.ts` is capped (see `scripts/vision-guard.mjs`). Nothing named `Internal*` may be public except the allowlist (`InternalEvent` is the public event contract).
3. **Impl size ceiling** — `packages/core/src` is capped per file and in total. Growing past the ceiling fails, so "reduce complexity" has a gradient.
4. **Determinism** — no `Date.now`, `Math.random`, or `performance.now` in core runtime. Only `real-clock.ts` reads the wall clock. Same inputs, same trace, always.

Type-level tests live in `packages/core/tests/typecheck.test.ts` (`expectTypeOf` + `@ts-expect-error`). Wrong usage fails `vp check`; the runtime tests and the type oracle are the same file.

## Review Checklist

- [ ] Run `vp check` — format, lint, type errors, including the type-level assertions.
- [ ] Run `vp run guard` — north star gates (part of `vp run ready`).
- [ ] Never silence the compiler. If a change needs `as any`, `as unknown as`, or `@ts-*`, the design is wrong, not the types. Refactor instead.
- [ ] `@mantaq/core` stays small. New exports and new impl lines cost budget; measure before adding.
- [ ] Run `vp run mutation:core` and `vp run mutation:sugar` — mutation score must stay above the break threshold (90).

<!--VISION ENFORCEMENT END-->
