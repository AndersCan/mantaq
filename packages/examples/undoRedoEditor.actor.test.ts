/**
 * Problem: Undo/redo with command pattern. Real editors track history of
 * context mutations and need multi-level undo/redo with checkpoints.
 *
 * Actor model approach:
 *   - Text buffer in context (the data being mutated)
 *   - Undo/redo stacks also in context (array of snapshots)
 *   - Every editing transition pushes to undo stack
 *   - Undo/redo events pop from respective stacks and restore context
 *   - Checkpoint events create named save points
 *
 * DX Issues found:
 *   1. Context mutation in transitions is not type-safe (existing finding)
 *   2. Undo/redo requires manual snapshot + restore of context — no built-in
 *      context snapshotting mechanism
 *   3. Undo/redo stacks grow without bound — no built-in GC or max-size
 *   4. No way to intercept all transitions for logging/replay (middleware gap)
 *   5. Guard conditions for "canUndo"/"canRedo" require checking context length
 *      — verbose and error-prone
 *   6. Undo event must reconstruct previous context from stack, but actor
 *      model doesn't provide context diffing or patching
 *   7. Checkpoint + undo-to-checkpoint requires stack search — no ordered
 *      history traversal API
 *   8. Multiple concurrent undo stacks (per-field vs global) would need regions
 *      but regions don't share context
 *
 * Structure:
 *   idle ←→ editing ←→ undoing ←→ redoing
 *   editing triggers undo/redo stack management
 *   idle is rest state after all undo/redo exhausted
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";

// ── Types ────────────────────────────────────────────────────────────
interface TextBuffer {
  content: string;
  cursor: number;
}

interface HistoryEntry {
  buffer: TextBuffer;
  label: string;
}

interface EditorContext {
  buffer: TextBuffer;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  checkpoints: Map<string, number>;
}

// ── States ───────────────────────────────────────────────────────────
const s = states("idle", "editing");

// ── Events ───────────────────────────────────────────────────────────
const insertTextEvent = event("INSERT_TEXT")<{ text: string; at: number }>();
const deleteTextEvent = event("DELETE_TEXT")<{ from: number; to: number }>();
const replaceTextEvent = event("REPLACE_TEXT")<{ from: number; to: number; text: string }>();
const checkpointEvent = event("CHECKPOINT")<{ name: string }>();
const undoToCheckpointEvent = event("UNDO_TO_CHECKPOINT")<{ name: string }>();
const e = events("UNDO", "REDO", "CLEAR_HISTORY");

// ── Helpers ──────────────────────────────────────────────────────────
function snapshotBuffer(buffer: TextBuffer): TextBuffer {
  return { content: buffer.content, cursor: buffer.cursor };
}

function insertAt(str: string, index: number, insert: string): string {
  return str.slice(0, index) + insert + str.slice(index);
}

function deleteRange(str: string, from: number, to: number): string {
  return str.slice(0, from) + str.slice(to);
}

// ── Actor factory ────────────────────────────────────────────────────
function createEditorActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const context: EditorContext = {
    buffer: { content: "", cursor: 0 },
    undoStack: [],
    redoStack: [],
    checkpoints: new Map(),
  };

  const actor = new Actor({
    inputs: [
      insertTextEvent,
      deleteTextEvent,
      replaceTextEvent,
      e.UNDO,
      e.REDO,
      checkpointEvent,
      undoToCheckpointEvent,
      e.CLEAR_HISTORY,
    ],
    outputs: [],
    internal: [],
    states: [s.idle, s.editing],
    initial: s.idle,
    clock: c,
    context,
    setup: (m) => {
      m.onAny(e.UNDO, (_event, { context }) => {
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
      m.onAny(e.REDO, (_event, { context }) => {
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
      m.onAny(undoToCheckpointEvent, (event, { context }) => {
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
      m.onAny(e.CLEAR_HISTORY, (_event, { context }) => {
        const cur = context.get();
        cur.undoStack = [];
        cur.redoStack = [];
        cur.checkpoints = new Map();
        context.set(cur);
        return {};
      });
      m.on(s.idle, insertTextEvent, (event, { context }) => {
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
      m.on(s.idle, deleteTextEvent, (event, { context }) => {
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
      m.on(s.idle, replaceTextEvent, (event, { context }) => {
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
      m.on(s.idle, checkpointEvent, (event, { context }) => {
        const cur = context.get();
        cur.checkpoints = new Map(cur.checkpoints);
        cur.checkpoints.set(event.payload.name, cur.undoStack.length);
        context.set(cur);
        return {};
      });
      m.on(s.editing, insertTextEvent, (event, { context }) => {
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
      m.on(s.editing, deleteTextEvent, (event, { context }) => {
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
      m.on(s.editing, replaceTextEvent, (event, { context }) => {
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
      m.on(s.editing, checkpointEvent, (event, { context }) => {
        const cur = context.get();
        cur.checkpoints = new Map(cur.checkpoints);
        cur.checkpoints.set(event.payload.name, cur.undoStack.length);
        context.set(cur);
        return {};
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("undo/redo editor actor", () => {
  it("starts idle with empty buffer", () => {
    const { actor } = createEditorActor();
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.context.buffer.content).toBe("");
    expect(actor.context.undoStack.length).toBe(0);
    expect(actor.context.redoStack.length).toBe(0);
  });

  it("INSERT_TEXT transitions to editing, pushes undo stack", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect(matches(actor, "editing")).toBe(true);
    expect(actor.context.buffer.content).toBe("hello");
    expect(actor.context.buffer.cursor).toBe(5);
    expect(actor.context.undoStack.length).toBe(1);
    expect(actor.context.redoStack.length).toBe(0);
  });

  it("multiple INSERT_TEXT operations accumulate on undo stack", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(actor.context.buffer.content).toBe("hello world");
    expect(actor.context.undoStack.length).toBe(2);
  });

  it("UNDO restores previous buffer state", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(actor.context.buffer.content).toBe("hello world");

    actor.send(e.UNDO.create());
    expect(matches(actor, "editing")).toBe(true);
    expect(actor.context.buffer.content).toBe("hello");
    expect(actor.context.undoStack.length).toBe(1);
    expect(actor.context.redoStack.length).toBe(1);
  });

  it("UNDO from empty stack goes to idle", () => {
    const { actor } = createEditorActor();

    actor.send(e.UNDO.create());
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.context.undoStack.length).toBe(0);
  });

  it("UNDO then REDO restores buffer", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect(actor.context.buffer.content).toBe("hello");

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.content).toBe("");

    actor.send(e.REDO.create());
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.context.buffer.content).toBe("hello");
    expect(actor.context.undoStack.length).toBe(1);
    expect(actor.context.redoStack.length).toBe(0);
  });

  it("REDO from empty stack goes to idle", () => {
    const { actor } = createEditorActor();

    actor.send(e.REDO.create());
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.context.redoStack.length).toBe(0);
  });

  it("new edit after undo clears redo stack", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(e.UNDO.create());
    expect(actor.context.redoStack.length).toBe(1);

    actor.send(insertTextEvent.create({ text: "world", at: 0 }));
    expect(actor.context.redoStack.length).toBe(0);
    expect(actor.context.buffer.content).toBe("world");
  });

  it("DELETE_TEXT undoes correctly", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(deleteTextEvent.create({ from: 2, to: 4 }));
    expect(actor.context.buffer.content).toBe("heo");

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.content).toBe("hello");
  });

  it("REPLACE_TEXT undoes correctly", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(replaceTextEvent.create({ from: 0, to: 5, text: "world" }));
    expect(actor.context.buffer.content).toBe("world");

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.content).toBe("hello");
  });

  it("CHECKPOINT saves undo stack position", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(checkpointEvent.create({ name: "before-world" }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));

    expect(actor.context.checkpoints.get("before-world")).toBe(1);
    expect(actor.context.buffer.content).toBe("hello world");
  });

  it("UNDO_TO_CHECKPOINT undoes all operations since checkpoint", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "a", at: 0 }));
    actor.send(checkpointEvent.create({ name: "start" }));
    actor.send(insertTextEvent.create({ text: "b", at: 1 }));
    actor.send(insertTextEvent.create({ text: "c", at: 2 }));
    expect(actor.context.buffer.content).toBe("abc");

    actor.send(undoToCheckpointEvent.create({ name: "start" }));
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.context.buffer.content).toBe("a");
    expect(actor.context.undoStack.length).toBe(1);
  });

  it("UNDO_TO_CHECKPOINT with unknown name goes to idle", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(undoToCheckpointEvent.create({ name: "nonexistent" }));
    expect(matches(actor, "idle")).toBe(true);
  });

  it("CLEAR_HISTORY resets stacks", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(checkpointEvent.create({ name: "save1" }));
    expect(actor.context.undoStack.length).toBe(1);

    actor.send(e.CLEAR_HISTORY.create());
    expect(actor.context.undoStack.length).toBe(0);
    expect(actor.context.redoStack.length).toBe(0);
    expect(actor.context.checkpoints.size).toBe(0);
  });

  it("cursor position tracks correctly across operations", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect(actor.context.buffer.cursor).toBe(5);

    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(actor.context.buffer.cursor).toBe(11);

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.cursor).toBe(5);

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.cursor).toBe(0);
  });

  it("undo stack label matches operation", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(deleteTextEvent.create({ from: 1, to: 3 }));

    expect(actor.context.undoStack[0].label).toBe('insert "hello" at 0');
    expect(actor.context.undoStack[1].label).toBe("delete [1..3]");
  });

  it("full undo/redo cycle with multiple operations", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "a", at: 0 }));
    actor.send(insertTextEvent.create({ text: "b", at: 1 }));
    actor.send(insertTextEvent.create({ text: "c", at: 2 }));
    expect(actor.context.buffer.content).toBe("abc");

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.content).toBe("ab");

    actor.send(e.UNDO.create());
    expect(actor.context.buffer.content).toBe("a");

    actor.send(e.REDO.create());
    expect(actor.context.buffer.content).toBe("ab");

    actor.send(e.REDO.create());
    expect(actor.context.buffer.content).toBe("abc");

    actor.send(e.UNDO.create());
    actor.send(e.UNDO.create());
    actor.send(e.UNDO.create());
    expect(actor.context.buffer.content).toBe("");
    expect(matches(actor, "idle")).toBe(true);
  });
});
