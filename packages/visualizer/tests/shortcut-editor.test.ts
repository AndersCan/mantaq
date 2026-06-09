import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import {
  $shortcutEditorVisible,
  $editingShortcutId,
  $listeningForKey,
  openShortcutEditor,
  closeShortcutEditor,
  startEditingShortcut,
  stopEditing,
  captureKey,
} from "../src/components/shortcut-editor.ts";
import "../src/components/shortcut-editor.ts";
import { $shortcuts, DEFAULT_SHORTCUTS } from "../src/shortcut-registry.ts";

afterEach(() => {
  document.body.innerHTML = "";
  $shortcutEditorVisible.set(false);
  $editingShortcutId.set(null);
  $listeningForKey.set(false);
  $shortcuts.set(DEFAULT_SHORTCUTS);
});

describe("ShortcutEditor component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("shortcut-editor");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("shortcut-editor");
  });

  it("is hidden by default", () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    expect($shortcutEditorVisible.get()).toBe(false);
    expect(el.shadowRoot!.querySelector(".editor-backdrop")).toBeNull();
  });

  it("shows when openShortcutEditor called", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    expect($shortcutEditorVisible.get()).toBe(true);
    const backdrop = el.shadowRoot!.querySelector(".editor-backdrop");
    expect(backdrop).toBeDefined();
  });

  it("has dialog role", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector("[role='dialog']")).toBeDefined();
  });

  it("has close button", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    const closeBtn = el.shadowRoot!.querySelector(".close-btn");
    expect(closeBtn).toBeDefined();
  });

  it("close button hides editor", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    const closeBtn = el.shadowRoot!.querySelector(".close-btn") as HTMLButtonElement;
    closeBtn.click();
    expect($shortcutEditorVisible.get()).toBe(false);
  });

  it("has reset button", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    const resetBtn = el.shadowRoot!.querySelector(".btn-danger");
    expect(resetBtn).toBeDefined();
  });

  it("renders shortcut rows", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    const rows = el.shadowRoot!.querySelectorAll(".shortcut-row");
    expect(rows.length).toBe(DEFAULT_SHORTCUTS.length);
  });

  it("renders key buttons", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".shortcut-key-btn");
    expect(buttons.length).toBe(DEFAULT_SHORTCUTS.length);
  });

  it("clicking backdrop hides editor", async () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    openShortcutEditor();
    await Promise.resolve();
    const backdrop = el.shadowRoot!.querySelector(".editor-backdrop") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect($shortcutEditorVisible.get()).toBe(false);
  });

  it("cleans up on disconnect", () => {
    const el = document.createElement("shortcut-editor") as HTMLElement;
    document.body.appendChild(el);
    el.remove();
    openShortcutEditor();
    expect($shortcutEditorVisible.get()).toBe(true);
  });
});

describe("shortcut editing", () => {
  beforeEach(() => {
    $shortcuts.set(DEFAULT_SHORTCUTS);
  });

  it("startEditingShortcut sets editing id", () => {
    startEditingShortcut("zoom-in");
    expect($editingShortcutId.get()).toBe("zoom-in");
    expect($listeningForKey.get()).toBe(true);
  });

  it("stopEditing clears editing state", () => {
    startEditingShortcut("zoom-in");
    stopEditing();
    expect($editingShortcutId.get()).toBeNull();
    expect($listeningForKey.get()).toBe(false);
  });

  it("captureKey with Escape cancels editing", () => {
    startEditingShortcut("zoom-in");
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    captureKey(e);
    expect($editingShortcutId.get()).toBeNull();
    expect($listeningForKey.get()).toBe(false);
  });

  it("captureKey updates shortcut", () => {
    startEditingShortcut("zoom-in");
    const e = new KeyboardEvent("keydown", { key: "z" });
    captureKey(e);
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.key).toBe("z");
    expect($editingShortcutId.get()).toBeNull();
  });

  it("captureKey with ctrl modifier", () => {
    startEditingShortcut("zoom-in");
    const e = new KeyboardEvent("keydown", { key: "z", ctrlKey: true });
    captureKey(e);
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.key).toBe("z");
    expect(updated!.ctrl).toBe(true);
  });

  it("captureKey with shift modifier", () => {
    startEditingShortcut("zoom-in");
    const e = new KeyboardEvent("keydown", { key: "Z", shiftKey: true });
    captureKey(e);
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.shift).toBe(true);
  });

  it("captureKey preserves other fields", () => {
    startEditingShortcut("zoom-in");
    const e = new KeyboardEvent("keydown", { key: "z" });
    captureKey(e);
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.description).toBe("Zoom in");
    expect(updated!.action).toBe("zoom-in");
  });

  it("captureKey with no editing id is no-op", () => {
    $editingShortcutId.set(null);
    const e = new KeyboardEvent("keydown", { key: "z" });
    captureKey(e);
    const original = DEFAULT_SHORTCUTS.find((s) => s.id === "zoom-in")!;
    const current = $shortcuts.get().find((s) => s.id === "zoom-in")!;
    expect(current.key).toBe(original.key);
  });
});

describe("Ctrl+, to open shortcut editor", () => {
  it("$shortcutEditorVisible defaults to false", () => {
    expect($shortcutEditorVisible.get()).toBe(false);
  });

  it("openShortcutEditor sets visible", () => {
    openShortcutEditor();
    expect($shortcutEditorVisible.get()).toBe(true);
  });

  it("closeShortcutEditor hides editor", () => {
    openShortcutEditor();
    closeShortcutEditor();
    expect($shortcutEditorVisible.get()).toBe(false);
  });
});
