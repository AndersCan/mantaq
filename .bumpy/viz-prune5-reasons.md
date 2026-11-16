---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

[user]: Select any arrow in the visualizer and Details either shows Send or says in one line why it can't be sent: the walk is in another state, another part sends the event, or the guard would take the walk somewhere else.
[user]: An arrow whose guard would land in a different state than the one drawn is now locked and says where it goes. A machine whose example values always take one branch now shows locks on the other branches; change the value in Context to try them.
