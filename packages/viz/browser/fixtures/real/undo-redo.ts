/**
 * PINNED FIXTURE — undo-redo.
 *
 * Source: packages/examples/undoRedoEditor.actor.test.ts (`createEditorActor`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + tests/fingerprints.test.ts) catches
 * upstream refactors that change the graph shape.
 *
 * Story: command-pattern editor with undo/redo stacks + checkpoints in
 * context. 8 inputs — the best timeline fixture (plan §9.2). Context holds a
 * Map (checkpoints) — exercises the inspector's map rendering later.
 *
 *   idle ←→ editing (UNDO/REDO pop stacks; exhausted stacks → idle)
 *
 * Deterministic: no Math.random / Date.now.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

interface TextBuffer {
  content: string;
  cursor: number;
}

interface HistoryEntry {
  buffer: TextBuffer;
  label: string;
}

// `type` not `interface` (as in the source): the actor's context generic is
// the fixture host's `AnyActor` (context = Record<string, unknown>); type
// aliases get an implicit index signature, interfaces don't.
type EditorContext = {
  buffer: TextBuffer;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  checkpoints: Map<string, number>;
};

const s = {
  idle: state("idle")(),
  editing: state("editing")(),
};

export const insertText = event("INSERT_TEXT")<{ text: string; at: number }>();
export const deleteText = event("DELETE_TEXT")<{ from: number; to: number }>();
export const replaceText = event("REPLACE_TEXT")<{ from: number; to: number; text: string }>();
// Module-private: machine-internal events, not exposed on the bridge.
const checkpoint = event("CHECKPOINT")<{ name: string }>();
const undoToCheckpoint = event("UNDO_TO_CHECKPOINT")<{ name: string }>();
export const undo = event("UNDO")();
export const redo = event("REDO")();
export const clearHistory = event("CLEAR_HISTORY")();

function snapshotBuffer(buffer: TextBuffer): TextBuffer {
  return { content: buffer.content, cursor: buffer.cursor };
}

function insertAt(str: string, index: number, insert: string): string {
  return str.slice(0, index) + insert + str.slice(index);
}

function deleteRange(str: string, from: number, to: number): string {
  return str.slice(0, from) + str.slice(to);
}

export function createEditorActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const context: EditorContext = {
    buffer: { content: "", cursor: 0 },
    undoStack: [],
    redoStack: [],
    checkpoints: new Map(),
  };

  const actor = new Actor({
    inputs: [
      insertText,
      deleteText,
      replaceText,
      undo,
      redo,
      checkpoint,
      undoToCheckpoint,
      clearHistory,
    ],
    outputs: [],
    internal: [],
    states: [s.idle, s.editing],
    initial: s.idle,
    clock: c,
    context,
    setup: (m) => {
      m.onAny(undo, (_event, { context }) => {
        const cur = context.get();
        if (cur.undoStack.length === 0) {
          return { state: s.idle };
        }
        const entry = cur.undoStack[cur.undoStack.length - 1]!;
        cur.undoStack = cur.undoStack.slice(0, -1);
        cur.redoStack = [
          ...cur.redoStack,
          { buffer: snapshotBuffer(cur.buffer), label: entry.label },
        ];
        cur.buffer = snapshotBuffer(entry.buffer);
        context.set(cur);
        if (cur.undoStack.length === 0) {
          return { state: s.idle };
        }
        return { state: s.editing };
      });
      m.onAny(redo, (_event, { context }) => {
        const cur = context.get();
        if (cur.redoStack.length === 0) {
          return { state: s.idle };
        }
        const entry = cur.redoStack[cur.redoStack.length - 1]!;
        cur.redoStack = cur.redoStack.slice(0, -1);
        cur.undoStack = [
          ...cur.undoStack,
          { buffer: snapshotBuffer(cur.buffer), label: entry.label },
        ];
        cur.buffer = snapshotBuffer(entry.buffer);
        context.set(cur);
        if (cur.redoStack.length === 0) {
          return { state: s.idle };
        }
        return { state: s.editing };
      });
      m.onAny(undoToCheckpoint, (event, { context }) => {
        const cur = context.get();
        const targetIndex = cur.checkpoints.get(event.payload.name);
        if (targetIndex === undefined) {
          return { state: s.idle };
        }
        while (cur.undoStack.length > targetIndex) {
          const entry = cur.undoStack[cur.undoStack.length - 1]!;
          cur.undoStack = cur.undoStack.slice(0, -1);
          cur.redoStack = [
            ...cur.redoStack,
            { buffer: snapshotBuffer(cur.buffer), label: entry.label },
          ];
          cur.buffer = snapshotBuffer(entry.buffer);
        }
        context.set(cur);
        return { state: s.idle };
      });
      m.onAny(clearHistory, (_event, { context }) => {
        const cur = context.get();
        cur.undoStack = [];
        cur.redoStack = [];
        cur.checkpoints = new Map();
        context.set(cur);
        return {};
      });
      m.on(s.idle, insertText, (event, { context }) => {
        const cur = context.get();
        cur.undoStack = [
          ...cur.undoStack,
          {
            buffer: snapshotBuffer(cur.buffer),
            label: `insert "${event.payload.text}" at ${event.payload.at}`,
          },
        ];
        cur.redoStack = [];
        cur.buffer = {
          content: insertAt(cur.buffer.content, event.payload.at, event.payload.text),
          cursor: event.payload.at + event.payload.text.length,
        };
        context.set(cur);
        return { state: s.editing };
      });
      m.on(s.idle, deleteText, (event, { context }) => {
        const cur = context.get();
        cur.undoStack = [
          ...cur.undoStack,
          {
            buffer: snapshotBuffer(cur.buffer),
            label: `delete [${event.payload.from}..${event.payload.to}]`,
          },
        ];
        cur.redoStack = [];
        cur.buffer = {
          content: deleteRange(cur.buffer.content, event.payload.from, event.payload.to),
          cursor: event.payload.from,
        };
        context.set(cur);
        return { state: s.editing };
      });
      m.on(s.idle, replaceText, (event, { context }) => {
        const cur = context.get();
        cur.undoStack = [
          ...cur.undoStack,
          {
            buffer: snapshotBuffer(cur.buffer),
            label: `replace [${event.payload.from}..${event.payload.to}] with "${event.payload.text}"`,
          },
        ];
        cur.redoStack = [];
        const deleted = deleteRange(cur.buffer.content, event.payload.from, event.payload.to);
        cur.buffer = {
          content: insertAt(deleted, event.payload.from, event.payload.text),
          cursor: event.payload.from + event.payload.text.length,
        };
        context.set(cur);
        return { state: s.editing };
      });
      m.on(s.idle, checkpoint, (event, { context }) => {
        const cur = context.get();
        cur.checkpoints = new Map(cur.checkpoints);
        cur.checkpoints.set(event.payload.name, cur.undoStack.length);
        context.set(cur);
        return {};
      });
      m.on(s.editing, insertText, (event, { context }) => {
        const cur = context.get();
        cur.undoStack = [
          ...cur.undoStack,
          {
            buffer: snapshotBuffer(cur.buffer),
            label: `insert "${event.payload.text}" at ${event.payload.at}`,
          },
        ];
        cur.redoStack = [];
        cur.buffer = {
          content: insertAt(cur.buffer.content, event.payload.at, event.payload.text),
          cursor: event.payload.at + event.payload.text.length,
        };
        context.set(cur);
        return {};
      });
      m.on(s.editing, deleteText, (event, { context }) => {
        const cur = context.get();
        cur.undoStack = [
          ...cur.undoStack,
          {
            buffer: snapshotBuffer(cur.buffer),
            label: `delete [${event.payload.from}..${event.payload.to}]`,
          },
        ];
        cur.redoStack = [];
        cur.buffer = {
          content: deleteRange(cur.buffer.content, event.payload.from, event.payload.to),
          cursor: event.payload.from,
        };
        context.set(cur);
        return {};
      });
      m.on(s.editing, replaceText, (event, { context }) => {
        const cur = context.get();
        cur.undoStack = [
          ...cur.undoStack,
          {
            buffer: snapshotBuffer(cur.buffer),
            label: `replace [${event.payload.from}..${event.payload.to}] with "${event.payload.text}"`,
          },
        ];
        cur.redoStack = [];
        const deleted = deleteRange(cur.buffer.content, event.payload.from, event.payload.to);
        cur.buffer = {
          content: insertAt(deleted, event.payload.from, event.payload.text),
          cursor: event.payload.from + event.payload.text.length,
        };
        context.set(cur);
        return {};
      });
    },
  });

  return { actor, clock: c };
}
