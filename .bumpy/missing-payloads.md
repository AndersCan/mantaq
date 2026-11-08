---
"@mantaq/inspect": minor
---

Fuzzing records each event it sent without a payload whose fields the machine then read: `Trace.missingPayloads`, `FuzzResult.missingPayloads` and `Inspected.missingPayloads` (type `MissingPayload`). The vague "no source" warning is replaced by one exact line per such event, and no longer appears for events the machine reads nothing from.

Breaking: none
