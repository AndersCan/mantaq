---
"@mantaq/viz": patch
---

A machine or an entered group that is too wide for its canvas, even with its labels at the smallest size, is drawn from top to bottom when that is narrower and overlaps no more. Machines with regions, actor maps or messages are still drawn from left to right. The graph's SVG says which way it runs in `data-flow` (`across` or `down`), and the viewer draws again when a width change makes the other way fit better.

After each step, and when you enter a group, the canvas scrolls to the current state and to the labels of the arrows that a click sends from it: all of them when they fit with the state, else the most of them that fit.
