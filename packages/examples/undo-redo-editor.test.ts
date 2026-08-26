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
 *   5. Guard conditions for canUndo/canRedo require checking context length
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

import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

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
const editorStates = states("idle", "editing");

// ── Events ───────────────────────────────────────────────────────────
const insertTextEvent = event("INSERT_TEXT")<{ text: string; at: number }>();
const deleteTextEvent = event("DELETE_TEXT")<{ from: number; to: number }>();
const replaceTextEvent = event("REPLACE_TEXT")<{ from: number; to: number; text: string }>();
const checkpointEvent = event("CHECKPOINT")<{ name: string }>();
const undoToCheckpointEvent = event("UNDO_TO_CHECKPOINT")<{ name: string }>();
const historyEvents = events("UNDO", "REDO", "CLEAR_HISTORY");

// ── Helpers ──────────────────────────────────────────────────────────
function snapshotBuffer(buffer: TextBuffer): TextBuffer {
  return { content: buffer.content, cursor: buffer.cursor };
}

function insertAt(text: string, options: { at: number; insert: string }): string {
  return text.slice(0, options.at) + options.insert + text.slice(options.at);
}

function deleteRange(text: string, options: { from: number; to: number }): string {
  return text.slice(0, options.from) + text.slice(options.to);
}

// ── Actor factory ────────────────────────────────────────────────────
function createEditorActor(clock?: VirtualClock) {
  const c = clock ?? VirtualClock();

  const context: EditorContext = {
    buffer: { content: "", cursor: 0 },
    undoStack: [],
    redoStack: [],
    checkpoints: new Map(),
  };

  const actor = Actor({
    inputs: [
      insertTextEvent,
      deleteTextEvent,
      replaceTextEvent,
      historyEvents.UNDO,
      historyEvents.REDO,
      checkpointEvent,
      undoToCheckpointEvent,
      historyEvents.CLEAR_HISTORY,
    ],
    outputs: [],
    internal: [],
    states: [editorStates.idle, editorStates.editing],
    initial: editorStates.idle,
    clock: c,
    context,
    setup: (m) => {
      m.onAny({
        eventRef: historyEvents.UNDO,
        handler: (_event, { context }) => {
          const cur = context.get();
          const entry = cur.undoStack[cur.undoStack.length - 1];
          if (!entry) {
            return { state: editorStates.idle };
          }
          cur.undoStack = cur.undoStack.slice(0, -1);
          cur.redoStack = [
            ...cur.redoStack,
            { buffer: snapshotBuffer(cur.buffer), label: entry.label },
          ];
          cur.buffer = snapshotBuffer(entry.buffer);
          context.set(cur);
          if (cur.undoStack.length === 0) {
            return { state: editorStates.idle };
          }
          return { state: editorStates.editing };
        },
      });
      m.onAny({
        eventRef: historyEvents.REDO,
        handler: (_event, { context }) => {
          const cur = context.get();
          const entry = cur.redoStack[cur.redoStack.length - 1];
          if (!entry) {
            return { state: editorStates.idle };
          }
          cur.redoStack = cur.redoStack.slice(0, -1);
          cur.undoStack = [
            ...cur.undoStack,
            { buffer: snapshotBuffer(cur.buffer), label: entry.label },
          ];
          cur.buffer = snapshotBuffer(entry.buffer);
          context.set(cur);
          if (cur.redoStack.length === 0) {
            return { state: editorStates.idle };
          }
          return { state: editorStates.editing };
        },
      });
      m.onAny({
        eventRef: undoToCheckpointEvent,
        handler: (event, { context }) => {
          const cur = context.get();
          const targetIndex = cur.checkpoints.get(event.payload.name);
          if (targetIndex === undefined) {
            return { state: editorStates.idle };
          }
          while (cur.undoStack.length > targetIndex) {
            const entry = cur.undoStack[cur.undoStack.length - 1];
            if (!entry) break;
            cur.undoStack = cur.undoStack.slice(0, -1);
            cur.redoStack = [
              ...cur.redoStack,
              { buffer: snapshotBuffer(cur.buffer), label: entry.label },
            ];
            cur.buffer = snapshotBuffer(entry.buffer);
          }
          context.set(cur);
          return { state: editorStates.idle };
        },
      });
      m.onAny({
        eventRef: historyEvents.CLEAR_HISTORY,
        handler: (_event, { context }) => {
          const cur = context.get();
          cur.undoStack = [];
          cur.redoStack = [];
          cur.checkpoints = new Map();
          context.set(cur);
          return {};
        },
      });
      m.on(editorStates.idle, {
        eventRef: insertTextEvent,
        handler: (event, { context }) => {
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
            content: insertAt(cur.buffer.content, {
              at: event.payload.at,
              insert: event.payload.text,
            }),
            cursor: event.payload.at + event.payload.text.length,
          };
          context.set(cur);
          return { state: editorStates.editing };
        },
      });
      m.on(editorStates.idle, {
        eventRef: deleteTextEvent,
        handler: (event, { context }) => {
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
            content: deleteRange(cur.buffer.content, {
              from: event.payload.from,
              to: event.payload.to,
            }),
            cursor: event.payload.from,
          };
          context.set(cur);
          return { state: editorStates.editing };
        },
      });
      m.on(editorStates.idle, {
        eventRef: replaceTextEvent,
        handler: (event, { context }) => {
          const cur = context.get();
          cur.undoStack = [
            ...cur.undoStack,
            {
              buffer: snapshotBuffer(cur.buffer),
              label: `replace [${event.payload.from}..${event.payload.to}] with "${event.payload.text}"`,
            },
          ];
          cur.redoStack = [];
          const deleted = deleteRange(cur.buffer.content, {
            from: event.payload.from,
            to: event.payload.to,
          });
          cur.buffer = {
            content: insertAt(deleted, { at: event.payload.from, insert: event.payload.text }),
            cursor: event.payload.from + event.payload.text.length,
          };
          context.set(cur);
          return { state: editorStates.editing };
        },
      });
      m.on(editorStates.idle, {
        eventRef: checkpointEvent,
        handler: (event, { context }) => {
          const cur = context.get();
          cur.checkpoints = new Map(cur.checkpoints);
          cur.checkpoints.set(event.payload.name, cur.undoStack.length);
          context.set(cur);
          return {};
        },
      });
      m.on(editorStates.editing, {
        eventRef: insertTextEvent,
        handler: (event, { context }) => {
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
            content: insertAt(cur.buffer.content, {
              at: event.payload.at,
              insert: event.payload.text,
            }),
            cursor: event.payload.at + event.payload.text.length,
          };
          context.set(cur);
          return {};
        },
      });
      m.on(editorStates.editing, {
        eventRef: deleteTextEvent,
        handler: (event, { context }) => {
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
            content: deleteRange(cur.buffer.content, {
              from: event.payload.from,
              to: event.payload.to,
            }),
            cursor: event.payload.from,
          };
          context.set(cur);
          return {};
        },
      });
      m.on(editorStates.editing, {
        eventRef: replaceTextEvent,
        handler: (event, { context }) => {
          const cur = context.get();
          cur.undoStack = [
            ...cur.undoStack,
            {
              buffer: snapshotBuffer(cur.buffer),
              label: `replace [${event.payload.from}..${event.payload.to}] with "${event.payload.text}"`,
            },
          ];
          cur.redoStack = [];
          const deleted = deleteRange(cur.buffer.content, {
            from: event.payload.from,
            to: event.payload.to,
          });
          cur.buffer = {
            content: insertAt(deleted, { at: event.payload.from, insert: event.payload.text }),
            cursor: event.payload.from + event.payload.text.length,
          };
          context.set(cur);
          return {};
        },
      });
      m.on(editorStates.editing, {
        eventRef: checkpointEvent,
        handler: (event, { context }) => {
          const cur = context.get();
          cur.checkpoints = new Map(cur.checkpoints);
          cur.checkpoints.set(event.payload.name, cur.undoStack.length);
          context.set(cur);
          return {};
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("undo/redo editor actor", () => {
  it("sets an idle state with an empty buffer initially", () => {
    const { actor } = createEditorActor();
    expect({
      matches: matches(actor, "idle"),
      content: actor.context.buffer.content,
      undoDepth: actor.context.undoStack.length,
      redoDepth: actor.context.redoStack.length,
    }).toEqual({ matches: true, content: "", undoDepth: 0, redoDepth: 0 });
  });

  it("updates to editing and adds to the undo stack on INSERT_TEXT", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    expect({
      matches: matches(actor, "editing"),
      content: actor.context.buffer.content,
      cursor: actor.context.buffer.cursor,
      undoDepth: actor.context.undoStack.length,
      redoDepth: actor.context.redoStack.length,
    }).toEqual({ matches: true, content: "hello", cursor: 5, undoDepth: 1, redoDepth: 0 });
  });

  it("adds every INSERT_TEXT onto the undo stack", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect({
      content: actor.context.buffer.content,
      undoDepth: actor.context.undoStack.length,
    }).toEqual({ content: "hello world", undoDepth: 2 });
  });

  it("returns the previous buffer when UNDO fires", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));
    expect(actor.context.buffer.content).toBe("hello world");

    actor.send(historyEvents.UNDO.create());
    expect({
      matches: matches(actor, "editing"),
      content: actor.context.buffer.content,
      undoDepth: actor.context.undoStack.length,
      redoDepth: actor.context.redoStack.length,
    }).toEqual({ matches: true, content: "hello", undoDepth: 1, redoDepth: 1 });
  });

  it("returns to idle when UNDO fires with an empty undo stack", () => {
    const { actor } = createEditorActor();

    actor.send(historyEvents.UNDO.create());
    expect({
      matches: matches(actor, "idle"),
      undoDepth: actor.context.undoStack.length,
    }).toEqual({ matches: true, undoDepth: 0 });
  });

  it("returns the original buffer when REDO follows UNDO", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));

    actor.send(historyEvents.UNDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "" });

    actor.send(historyEvents.REDO.create());
    expect({
      matches: matches(actor, "idle"),
      content: actor.context.buffer.content,
      undoDepth: actor.context.undoStack.length,
      redoDepth: actor.context.redoStack.length,
    }).toEqual({ matches: true, content: "hello", undoDepth: 1, redoDepth: 0 });
  });

  it("returns to idle when REDO fires with an empty redo stack", () => {
    const { actor } = createEditorActor();

    actor.send(historyEvents.REDO.create());
    expect({
      matches: matches(actor, "idle"),
      redoDepth: actor.context.redoStack.length,
    }).toEqual({ matches: true, redoDepth: 0 });
  });

  it("removes the redo stack when a new edit follows UNDO", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(historyEvents.UNDO.create());
    expect(actor.context.redoStack.length).toBe(1);

    actor.send(insertTextEvent.create({ text: "world", at: 0 }));
    expect({
      redoDepth: actor.context.redoStack.length,
      content: actor.context.buffer.content,
    }).toEqual({ redoDepth: 0, content: "world" });
  });

  it("returns the pre-delete buffer when UNDO follows DELETE_TEXT", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(deleteTextEvent.create({ from: 2, to: 4 }));

    actor.send(historyEvents.UNDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "hello" });
  });

  it("returns the pre-replace buffer when UNDO follows REPLACE_TEXT", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(replaceTextEvent.create({ from: 0, to: 5, text: "world" }));

    actor.send(historyEvents.UNDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "hello" });
  });

  it("adds a checkpoint marking the current undo stack position", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(checkpointEvent.create({ name: "before-world" }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));

    expect({
      checkpoint: actor.context.checkpoints.get("before-world"),
      content: actor.context.buffer.content,
    }).toEqual({ checkpoint: 1, content: "hello world" });
  });

  it("removes every operation added since the named checkpoint", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "a", at: 0 }));
    actor.send(checkpointEvent.create({ name: "start" }));
    actor.send(insertTextEvent.create({ text: "b", at: 1 }));
    actor.send(insertTextEvent.create({ text: "c", at: 2 }));
    expect(actor.context.buffer.content).toBe("abc");

    actor.send(undoToCheckpointEvent.create({ name: "start" }));
    expect({
      matches: matches(actor, "idle"),
      content: actor.context.buffer.content,
      undoDepth: actor.context.undoStack.length,
    }).toEqual({ matches: true, content: "a", undoDepth: 1 });
  });

  it("returns to idle when UNDO_TO_CHECKPOINT names an unknown checkpoint", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(undoToCheckpointEvent.create({ name: "nonexistent" }));
    expect(matches(actor, "idle")).toBe(true);
  });

  it("removes all history when CLEAR_HISTORY fires", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(checkpointEvent.create({ name: "save1" }));
    expect(actor.context.undoStack.length).toBe(1);

    actor.send(historyEvents.CLEAR_HISTORY.create());
    expect({
      undoDepth: actor.context.undoStack.length,
      redoDepth: actor.context.redoStack.length,
      checkpointCount: actor.context.checkpoints.size,
    }).toEqual({ undoDepth: 0, redoDepth: 0, checkpointCount: 0 });
  });

  it("keeps the cursor consistent across edits and undos", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(insertTextEvent.create({ text: " world", at: 5 }));

    actor.send(historyEvents.UNDO.create());

    actor.send(historyEvents.UNDO.create());
    expect({ cursor: actor.context.buffer.cursor }).toEqual({ cursor: 0 });
  });

  it("creates labeled undo entries for each operation", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "hello", at: 0 }));
    actor.send(deleteTextEvent.create({ from: 1, to: 3 }));

    expect([actor.context.undoStack[0]?.label, actor.context.undoStack[1]?.label]).toEqual([
      'insert "hello" at 0',
      "delete [1..3]",
    ]);
  });

  it("handles a full edit, undo, redo cycle across multiple operations", () => {
    const { actor } = createEditorActor();

    actor.send(insertTextEvent.create({ text: "a", at: 0 }));
    actor.send(insertTextEvent.create({ text: "b", at: 1 }));
    actor.send(insertTextEvent.create({ text: "c", at: 2 }));
    expect({ content: actor.context.buffer.content }).toEqual({ content: "abc" });

    actor.send(historyEvents.UNDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "ab" });

    actor.send(historyEvents.UNDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "a" });

    actor.send(historyEvents.REDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "ab" });

    actor.send(historyEvents.REDO.create());
    expect({ content: actor.context.buffer.content }).toEqual({ content: "abc" });

    actor.send(historyEvents.UNDO.create());
    actor.send(historyEvents.UNDO.create());
    actor.send(historyEvents.UNDO.create());
    expect({
      content: actor.context.buffer.content,
      matches: matches(actor, "idle"),
    }).toEqual({ content: "", matches: true });
  });
});
