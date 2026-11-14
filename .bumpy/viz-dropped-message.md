---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

The system view names who sent each message to whom on the Path and Step tab (`orders → w1: free → working`), and marks a message its receiver had no handler for: the arrow gets a `!` after its name, the Path row starts with `!` and says `dropped`, and Details says why.

Breaking: none. Path row text for steps that move other parts now starts those moves with the sender.
