---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

A click on an arrow that leaves the state the walk is in sends its event. This is also true for an arrow whose guard blocks it. The `?` on an arrow opens Details, which hold the arrow's send form: one box per payload field with the values a click sends (the values last sent, else the examples) and a Send button. A change stays for every later send of that event, and the dry run that locks an arrow uses the same values. The Context tab shows the live context, read only, and the declared context fields without a driver.

Links keep changed values as `?payload=<event>=<json>`. An old `?value=<field>=<json>` link still opens: its value goes to every event with a field of that name.

Breaking: `ViewerOptions.onNavigate` reports `payloads` instead of `values`. `ViewerOptions.payloads` is new, and `ViewerOptions.values` now only reads old links.

The inspect harness `send(event, payload)` types the payload into that event's send form. A key must be a field of that event, and the value stays set for later sends of the same event only.
