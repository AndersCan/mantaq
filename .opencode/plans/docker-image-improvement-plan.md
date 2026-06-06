# Docker Image Improvement Plan

## Files to Create/Modify

### 1. `entrypoint.sh`

```bash
#!/bin/bash
set -e
if [ -n "$GH_TOKEN" ]; then
  echo "$GH_TOKEN" | gh auth login --with-token
  gh auth setup-git
fi
git config --global user.name "${GIT_USER_NAME:-OpenCode Server}"
git config --global user.email "${GIT_USER_EMAIL:-opencode@localhost}"
git config --global credential.helper "!gh auth git-credential"
icm --version >/dev/null 2>&1 && echo "ICM ok" || echo "ICM not found"
rtk --version >/dev/null 2>&1 && echo "RTK ok" || echo "RTK not found"
exec "$@"
```

### 2. `Dockerfile` modifications

- Remove SSH build-arg / ssh-keyscan / insteadOf
- Add: `COPY entrypoint.sh /entrypoint.sh && chmod +x /entrypoint.sh`
- Add: `ENTRYPOINT ["/entrypoint.sh"]`

### 3. `.dockerignore`

```
.env
.git
node_modules
dist
build
data
*.md
.opencode/plans
```

### 4. `docker-compose.yml` fixes

- Port: 3000→4096 (or add `--port 3000` to opencode serve)
- `OPENCODE_API_URL` in telegram-bot: use same port
- Add healthcheck to opencode-server
- Add `.opencode` volume mount: `./.opencode:/app/.opencode`
- Replace macOS `~/Library` path with named volume

### 5. `.opencode/opencode.jsonc`

- Set model, enable github tools, add skills.paths

### 6. Skills: copy from host

```
~/.agents/skills/add-change/  →  .opencode/skills/add-change/
~/.agents/skills/find-skills/ →  .opencode/skills/find-skills/
~/.agents/skills/save-changes/ → .opencode/skills/save-changes/
~/.agents/skills/self-improvement/ → .opencode/skills/self-improvement/
```

### 7. Command files

`.opencode/command/icm.md` and `.opencode/command/rtk.md`

### 8. Test files

`test/verify-image.sh` and `docker-compose.test.yml`

### 9. `.env.example` — add OPENCODE_MODEL_PROVIDER/ID, ANTHROPIC_API_KEY

---

## Implementation Order

1. entrypoint.sh + Dockerfile
2. .dockerignore + docker-compose.yml
3. .opencode/opencode.jsonc + skills + commands
4. .env.example
5. test/ script + docker-compose.test.yml
6. Build & test
