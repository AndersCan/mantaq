---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

An event that three or more sibling states leave by the same arrows is drawn once, from a node naming those states; clicks, Send, Details and highlights work on it. Every transition is still drawn: a member arrow is no longer its own `g[data-edge-id]` element, the shared arrow carries its ids in `data-members`. The test harness finds shared arrows by member id.

Breaking: none
