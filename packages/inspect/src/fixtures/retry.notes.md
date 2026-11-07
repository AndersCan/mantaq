# Notes on retry.ts

mantaq notes v1. Written by the live viz page. Your coding agent applies the notes with status: open and then sets them to done.

- id: n1
  machine: retry
  on: state connecting
  status: open
  note: needs a cancel
- id: n2
  machine: retry
  on: state lockedOut
  status: open
  note: lock out only after three tries
