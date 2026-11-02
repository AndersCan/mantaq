---
"@mantaq/core": patch
---

Docs declare the actor context as a typed const instead of casting it with `as`. A cast hides missing fields.
