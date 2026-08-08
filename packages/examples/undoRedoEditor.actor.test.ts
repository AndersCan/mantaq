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

  const ctx: EditorContext = {
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
    context: ctx,
    setup: (m) => {
      m.onAny(e.UNDO, (_event, opts) => {
        const context = opts!.context;
        if (context.undoStack.length === 0) {
          return { state: s.idle };
        }
        const entry = context.undoStack.pop()!;
        context.redoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: entry.label,
        });
        context.buffer = snapshotBuffer(entry.buffer);
        if (context.undoStack.length === 0) {
          return { state: s.idle };
        }
        return { state: s.editing };
      });
      m.onAny(e.REDO, (_event, opts) => {
        const context = opts!.context;
        if (context.redoStack.length === 0) {
          return { state: s.idle };
        }
        const entry = context.redoStack.pop()!;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: entry.label,
        });
        context.buffer = snapshotBuffer(entry.buffer);
        if (context.redoStack.length === 0) {
          return { state: s.idle };
        }
        return { state: s.editing };
      });
      m.onAny(undoToCheckpointEvent, (event, opts) => {
        const context = opts!.context;
        const targetIndex = context.checkpoints.get(event.name);
        if (targetIndex === undefined) {
          return { state: s.idle };
        }
        while (context.undoStack.length > targetIndex) {
          const entry = context.undoStack.pop()!;
          context.redoStack.push({
            buffer: snapshotBuffer(context.buffer),
            label: entry.label,
          });
          context.buffer = snapshotBuffer(entry.buffer);
        }
        return { state: s.idle };
      });
      m.onAny(e.CLEAR_HISTORY, (_event, opts) => {
        const context = opts!.context;
        context.undoStack = [];
        context.redoStack = [];
        context.checkpoints.clear();
        return {};
      });
      m.on(s.idle, insertTextEvent, (event, opts) => {
        const context = opts!.context;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: `insert "${event.text}" at ${event.at}`,
        });
        context.redoStack = [];
        context.buffer.content = insertAt(context.buffer.content, event.at, event.text);
        context.buffer.cursor = event.at + event.text.length;
        return { state: s.editing };
      });
      m.on(s.idle, deleteTextEvent, (event, opts) => {
        const context = opts!.context;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: `delete [${event.from}..${event.to}]`,
        });
        context.redoStack = [];
        context.buffer.content = deleteRange(context.buffer.content, event.from, event.to);
        context.buffer.cursor = event.from;
        return { state: s.editing };
      });
      m.on(s.idle, replaceTextEvent, (event, opts) => {
        const context = opts!.context;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: `replace [${event.from}..${event.to}] with "${event.text}"`,
        });
        context.redoStack = [];
        const deleted = deleteRange(context.buffer.content, event.from, event.to);
        context.buffer.content = insertAt(deleted, event.from, event.text);
        context.buffer.cursor = event.from + event.text.length;
        return { state: s.editing };
      });
      m.on(s.idle, checkpointEvent, (event, opts) => {
        opts!.context.checkpoints.set(event.name, opts!.context.undoStack.length);
        return {};
      });
      m.on(s.editing, insertTextEvent, (event, opts) => {
        const context = opts!.context;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: `insert "${event.text}" at ${event.at}`,
        });
        context.redoStack = [];
        context.buffer.content = insertAt(context.buffer.content, event.at, event.text);
        context.buffer.cursor = event.at + event.text.length;
        return {};
      });
      m.on(s.editing, deleteTextEvent, (event, opts) => {
        const context = opts!.context;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: `delete [${event.from}..${event.to}]`,
        });
        context.redoStack = [];
        context.buffer.content = deleteRange(context.buffer.content, event.from, event.to);
        context.buffer.cursor = event.from;
        return {};
      });
      m.on(s.editing, replaceTextEvent, (event, opts) => {
        const context = opts!.context;
        context.undoStack.push({
          buffer: snapshotBuffer(context.buffer),
          label: `replace [${event.from}..${event.to}] with "${event.text}"`,
        });
        context.redoStack = [];
        const deleted = deleteRange(context.buffer.content, event.from, event.to);
        context.buffer.content = insertAt(deleted, event.from, event.text);
        context.buffer.cursor = event.from + event.text.length;
        return {};
      });
      m.on(s.editing, checkpointEvent, (event, opts) => {
        opts!.context.checkpoints.set(event.name, opts!.context.undoStack.length);
        return {};
      });
    },
  });

  return { actor, clock: c, ctx };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("undo/redo editor actor", () => {
  it("starts idle with empty buffer", () => {
    const { actor, ctx } = createEditorActor();
    expect(matches(actor, "idle")).toBe(true);
    expect(ctx.buffer.content).toBe("");
    expect(ctx.undoStack.length).toBe(0);
    expect(ctx.redoStack.length).toBe(0);
  });

  it("INSERT_TEXT transitions to editing, pushes undo stack", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect(matches(actor, "editing")).toBe(true);
    expect(ctx.buffer.content).toBe("hello");
    expect(ctx.buffer.cursor).toBe(5);
    expect(ctx.undoStack.length).toBe(1);
    expect(ctx.redoStack.length).toBe(0);
  });

  it("multiple INSERT_TEXT operations accumulate on undo stack", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(ctx.buffer.content).toBe("hello world");
    expect(ctx.undoStack.length).toBe(2);
  });

  it("UNDO restores previous buffer state", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(ctx.buffer.content).toBe("hello world");

    actor.send(e.UNDO.create());
    expect(matches(actor, "editing")).toBe(true);
    expect(ctx.buffer.content).toBe("hello");
    expect(ctx.undoStack.length).toBe(1);
    expect(ctx.redoStack.length).toBe(1);
  });

  it("UNDO from empty stack goes to idle", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(e.UNDO.create());
    expect(matches(actor, "idle")).toBe(true);
    expect(ctx.undoStack.length).toBe(0);
  });

  it("UNDO then REDO restores buffer", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect(ctx.buffer.content).toBe("hello");

    actor.send(e.UNDO.create());
    expect(ctx.buffer.content).toBe("");

    actor.send(e.REDO.create());
    expect(matches(actor, "idle")).toBe(true);
    expect(ctx.buffer.content).toBe("hello");
    expect(ctx.undoStack.length).toBe(1);
    expect(ctx.redoStack.length).toBe(0);
  });

  it("REDO from empty stack goes to idle", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(e.REDO.create());
    expect(matches(actor, "idle")).toBe(true);
    expect(ctx.redoStack.length).toBe(0);
  });

  it("new edit after undo clears redo stack", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(e.UNDO.create());
    expect(ctx.redoStack.length).toBe(1);

    actor.send(insertTextEvent.create({ text: "world", at: 0 }));
    expect(ctx.redoStack.length).toBe(0);
    expect(ctx.buffer.content).toBe("world");
  });

  it("DELETE_TEXT undoes correctly", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(deleteTextEvent.create({ from: 2, to: 4 }));
    expect(ctx.buffer.content).toBe("heo");

    actor.send(e.UNDO.create());
    expect(ctx.buffer.content).toBe("hello");
  });

  it("REPLACE_TEXT undoes correctly", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(replaceTextEvent.create({ from: 0, to: 5, text: "world" }));
    expect(ctx.buffer.content).toBe("world");

    actor.send(e.UNDO.create());
    expect(ctx.buffer.content).toBe("hello");
  });

  it("CHECKPOINT saves undo stack position", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(checkpointEvent.create({ name: "before-world" }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));

    expect(ctx.checkpoints.get("before-world")).toBe(1);
    expect(ctx.buffer.content).toBe("hello world");
  });

  it("UNDO_TO_CHECKPOINT undoes all operations since checkpoint", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "a", at: 0 }));
    actor.send(checkpointEvent.create({ name: "start" }));
    actor.send(insertTextEvent.create({ text: "b", at: 1 }));
    actor.send(insertTextEvent.create({ text: "c", at: 2 }));
    expect(ctx.buffer.content).toBe("abc");

    actor.send(undoToCheckpointEvent.create({ name: "start" }));
    expect(matches(actor, "idle")).toBe(true);
    expect(ctx.buffer.content).toBe("a");
    expect(ctx.undoStack.length).toBe(1);
  });

  it("UNDO_TO_CHECKPOINT with unknown name goes to idle", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(undoToCheckpointEvent.create({ name: "nonexistent" }));
    expect(matches(actor, "idle")).toBe(true);
  });

  it("CLEAR_HISTORY resets stacks", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(checkpointEvent.create({ name: "save1" }));
    expect(ctx.undoStack.length).toBe(1);

    actor.send(e.CLEAR_HISTORY.create());
    expect(ctx.undoStack.length).toBe(0);
    expect(ctx.redoStack.length).toBe(0);
    expect(ctx.checkpoints.size).toBe(0);
  });

  it("cursor position tracks correctly across operations", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect(ctx.buffer.cursor).toBe(5);

    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(ctx.buffer.cursor).toBe(11);

    actor.send(e.UNDO.create());
    expect(ctx.buffer.cursor).toBe(5);

    actor.send(e.UNDO.create());
    expect(ctx.buffer.cursor).toBe(0);
  });

  it("undo stack label matches operation", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(deleteTextEvent.create({ from: 1, to: 3 }));

    expect(ctx.undoStack[0].label).toBe('insert "hello" at 0');
    expect(ctx.undoStack[1].label).toBe("delete [1..3]");
  });

  it("full undo/redo cycle with multiple operations", () => {
    const { actor, ctx } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "a", at: 0 }));
    actor.send(insertTextEvent.create({ text: "b", at: 1 }));
    actor.send(insertTextEvent.create({ text: "c", at: 2 }));
    expect(ctx.buffer.content).toBe("abc");

    actor.send(e.UNDO.create());
    expect(ctx.buffer.content).toBe("ab");

    actor.send(e.UNDO.create());
    expect(ctx.buffer.content).toBe("a");

    actor.send(e.REDO.create());
    expect(ctx.buffer.content).toBe("ab");

    actor.send(e.REDO.create());
    expect(ctx.buffer.content).toBe("abc");

    actor.send(e.UNDO.create());
    actor.send(e.UNDO.create());
    actor.send(e.UNDO.create());
    expect(ctx.buffer.content).toBe("");
    expect(matches(actor, "idle")).toBe(true);
  });
});
