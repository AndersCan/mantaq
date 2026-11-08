---
"@mantaq/inspect": minor
---

`mantaq-check-site` takes `--links <file>` (repeatable) and `--site <url>`: every markdown link in the file to a run under the site address is opened in Chromium, and the check fails when the page is not built, no viewer there holds the machine, or the viewer says "No run named ...".
