---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

Live panel: next events are grouped like the static walk (Send an input, Effect reports back, Other internal events), with the effect each report comes from and its handler's doc, and the state's effects with their unhandled reports. Answer for a running effect by picking what it reports. Breaking: the live "Send an event" heading and `data-group="live"` list are gone; `[data-send]` and `[data-send-item]` are unchanged.
