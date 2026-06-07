# Self-Improvement Skill

Make substantial continuous improvements to codebase.

## Workflow

1. Branch from `wip` branch
2. Make 3-5+ related edits (tests, docs, bug fixes, features, typing, code quality)
3. Run `vp check` and `vp test` to verify
4. Use ICM for commit messages
5. Use bumpy for changeset
6. Create PR to `wip`

## Rules

- Branch name: `self-improvement/<short-description>`
- Each run: 3-5+ related edits minimum
- Verify: `vp check && vp test`
- PR target: `wip`
