---
name: add-change
description: Create bumpy bump file for package changes. Use when user wants to record change, add bump file, or prepare packages release.
argument-hint: "[description of changes]"
allowed-tools: Read Grep Glob Bash Edit Write
---

# Create bumpy bump file

Help user create **bumpy bump file** — markdown file in `.bumpy/` describing package changes. Bumpy uses these bump versions and generate changelogs.

## Steps

### 1. Gather context

Understand what changed. Run parallel:

- `git diff --stat` — changed files
- `git diff --cached --stat` — staged changes
- `bumpy status --json` — existing bump files

If user provided description via `$ARGUMENTS`, use that context.

Review diff output understand scope.

### 2. Identify affected packages

Determine which workspace packages changed. Map changed files packages based directory structure.

If unsure which packages exist:

```bash
bumpy status --packages 2>/dev/null || cat package.json
```

### 3. Determine bump levels

For each affected package, choose bump level:

| Level     | When to use                                                                    |
| --------- | ------------------------------------------------------------------------------ |
| **major** | Breaking changes: removed/renamed exports, changed signatures, dropped support |
| **minor** | New features: added exports, new options, new functionality                    |
| **patch** | Bug fixes, internal refactors, documentation, dependency updates               |

Use `none` acknowledge change without triggering direct bump. Cascading bumps other packages still apply normally.

### 4. Write clear summary

Concise summary for CHANGELOG entry. Short — single sentence, at most two. Good summaries:

- Start verb: "Added...", "Fixed...", "Refactored..."
- Focus user-facing impact, not implementation details
- Specific enough useful months later
- Avoid filler, jargon, restating bump level
- Don't list every file — describe logical change

Bad: "Updated the authentication module to fix an issue where the token refresh mechanism was not properly handling expired refresh tokens, causing silent failures in the auth flow."
Good: "Fixed token refresh failing silently on expired refresh tokens."

### 5. Create or update bump file

Check existing bump files on branch (step 1's `bumpy status`). If one exists covering same logical change, **update in place** editing `.bumpy/<name>.md` — adjust package list, bump levels, summary reflect current state. Don't create new bump file every incremental change same branch.

If no relevant bump file exists, create with CLI:

```bash
bumpy add \
  --packages "<pkg1>:<bump>,<pkg2>:<bump>" \
  --message "<summary>" \
  --name "<short-descriptive-name>"
```

`--name` should be short kebab-case slug describing change (e.g., `fix-auth-token-refresh`, `add-encryption-api`).

### Example

If user fixed bug in `@myorg/auth` that also required type change in `@myorg/types`:

```bash
bumpy add \
  --packages "@myorg/auth:patch,@myorg/types:patch" \
  --message "Fixed token refresh failing silently when refresh token expired." \
  --name "fix-token-refresh"
```

## Advanced: cascading bumps

If change core package should explicitly cascade dependents specific bump levels, write bump file directly instead CLI:

```bash
cat > .bumpy/<name>.md << 'EOF'
---
"@myorg/core":
  bump: minor
  cascade:
    "@myorg/plugin-*": patch
    "@myorg/cli": minor
"@myorg/utils": patch
---

Added new encryption provider. Plugins need patch bump compatibility.
EOF
```

## Important notes

- Only include packages that have **actual code changes** — bumpy handles dependency propagation automatically
- If user hasn't made changes yet, ask what they're planning change
- If change doesn't affect publishable packages (e.g., only root config files), suggest `bumpy add --empty` satisfy CI checks
- One bump file per logical change — don't combine unrelated changes
- **Keep bump files up to date** — as work continues branch, bump file should reflect final state all changes, not just first commit. If packages added/removed or bump level changed (e.g., patch fix grew into minor feature), update existing bump file accordingly
