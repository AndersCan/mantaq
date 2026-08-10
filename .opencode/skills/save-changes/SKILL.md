---
name: save-changes
description: Save and commit changes. Run after meaningful work done and user confirms ready to commit.
allowed-tools: Read Grep Glob Bash Edit Write
metadata:
  internal: true
---

# Save changes

Run through commit checklist after user confirms changes ready.

## Steps

### 1. Store summary in ICM

Write short caveman summary of work done:

```bash
icm store -t context-mantaq -c "[Caveman summary] [Size of change: small/medium/large]"
```

> See [`icm` command](../command/icm.md) for docs.

### 2. Run add-change skill

Load and run [`add-change`](../add-change/SKILL.md) skill to create bumpy bump file.

### 3. Commit changes

Stage all changes and commit using bumpy message from step 2:

```bash
git add -A
git commit
```

Use bump file summary as commit message base. Keep commit message concise.

### 4. Verify

Run `git status` confirm clean tree. Report commit hash to user.
