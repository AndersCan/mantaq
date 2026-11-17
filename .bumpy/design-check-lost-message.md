---
"@mantaq/inspect": minor
---

expectNoDesignErrors fails on a message one machine sends another that handles it in none of its states. Breaking: a suite whose machines send such a message now fails; handle the event or stop sending it.
