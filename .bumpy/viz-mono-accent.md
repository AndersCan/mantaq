---
"@mantaq/viz": patch
"@mantaq/inspect": patch
---

Viewer text, lines and controls are black and white; colour appears only on graph highlights.

Breaking: `--accent` no longer colours controls (they use `--fg`). Themed embeds should also map the new `--select`, `--grid` and `--shadow` variables.
