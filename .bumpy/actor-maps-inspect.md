---
"@mantaq/sugar": minor
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

Actor maps reach the inspector. `ActorMap.get(key)` returns the live child. Return the map next to the actor (`return { actor, photos }`) and the inspector draws one child's states as a compartment named after the map, the live driver lists the children (`VizLiveState.children`) and steps can go to one (`actor: { map, key }`, `photos[p1]>uploadConfirmed` in links).

Breaking: document format v15 (`VizMachine.maps`) — affects anyone serving a prebuilt viz.json; rebuild it.

Breaking: VizLiveState.children is required — affects custom VizDriver implementations.
