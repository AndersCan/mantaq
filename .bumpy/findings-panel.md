---
"@mantaq/viz": minor
---

The diagram panel shows each finding as a card: the headline first, then the proof, the fix, and Replay (labelled for what it shows) or the reason there is nothing to replay. Clicking the ! on a state brings its first finding into view. Naming notes sit under "Naming notes" and no longer put a ! on the diagram; findings about the whole machine show at the top of the Details tab.

Breaking: `FINDING_KINDS` is removed from `@mantaq/viz` — read `title`, `proof` and `fix` from each finding instead.
