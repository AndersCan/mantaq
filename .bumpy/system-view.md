---
"@mantaq/viz": minor
---

The viewer opens on a system view when the parts of a machine (its regions and actor maps) send each other events: a box per part with its state, `workers ×3` with a count per state for a map, and an arrow per event between parts. A step turns the arrow that carried it pink. Click an arrow for who sends it and who takes it in which states, then Open to land on it in the part's diagram; `← System` comes back. Edges that send to another part say so in their Details.

Breaking: a machine whose parts link now opens on the system view instead of the diagram. That affects any embed of such a machine, such as the docs' photo-upload.
