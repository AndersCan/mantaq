---
name: icm
description: Intent-Context-Memory — persistent memory across agent sessions
---

# ICM

ICM stores and recalls memories across sessions.

- `icm store -t <topic> -c "<content>" -i <priority>` — store a memory
- `icm recall "<query>"` — search memories
- `icm recall-context "<query>" --limit 5` — formatted for prompt injection
- `icm health` — topic hygiene audit
- `icm topics` — list all topics
