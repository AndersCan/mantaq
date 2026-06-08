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
