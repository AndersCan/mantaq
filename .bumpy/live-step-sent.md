---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

A live step lists the outputs the machine sent out, as "Sent out: …", and names where the app takes each one when the page passes `routes` to the viewer. Breaking: `VizLiveStep.sent` is now required, so a hand-written `VizDriver` must fill it (`[]` when nothing was sent).
