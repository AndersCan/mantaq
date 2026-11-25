---
"@mantaq/viz": patch
---

A machine or an entered group that is too wide for its canvas, even with its labels at the smallest size, is drawn from top to bottom when that is narrower and overlaps no more. Machines with regions, actor maps or messages are still drawn from left to right. The viewer draws again when a change of the window width makes the other way fit better.

After each step, after a move along the path, and after a change of the window width, the canvas scrolls to the current state and to the labels of the arrows that a click sends now: all of them when they fit with the state, else the most of them that fit.
