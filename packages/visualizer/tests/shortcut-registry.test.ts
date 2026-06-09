import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  DEFAULT_SHORTCUTS,
  $shortcuts,
  matchShortcut,
  formatShortcutKey,
  groupShortcutsByCategory,
  getShortcutsForAction,
  updateShortcut,
  resetShortcuts,
  addShortcut,
  removeShortcut,
  SHORTCUT_CATEGORIES,
  type ShortcutDefinition,
} from "../src/shortcut-registry.ts";

function makeKeyEvent(
  key: string,
  opts: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    metaKey: opts.metaKey ?? false,
    bubbles: true,
  });
}

describe("shortcut registry", () => {
  beforeEach(() => {
    $shortcuts.set(DEFAULT_SHORTCUTS);
  });

  it("has default shortcuts", () => {
    expect(DEFAULT_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it("has zoom-in shortcut", () => {
    const s = DEFAULT_SHORTCUTS.find((s) => s.id === "zoom-in");
    expect(s).toBeDefined();
    expect(s!.key).toBe("+");
  });

  it("has navigation shortcuts", () => {
    const nav = DEFAULT_SHORTCUTS.filter((s) => s.category === SHORTCUT_CATEGORIES.NAVIGATION);
    expect(nav.length).toBeGreaterThan(0);
  });

  it("has selection shortcuts", () => {
    const sel = DEFAULT_SHORTCUTS.filter((s) => s.category === SHORTCUT_CATEGORIES.SELECTION);
    expect(sel.length).toBeGreaterThan(0);
  });

  it("has search shortcuts", () => {
    const search = DEFAULT_SHORTCUTS.filter((s) => s.category === SHORTCUT_CATEGORIES.SEARCH);
    expect(search.length).toBeGreaterThan(0);
  });
});

describe("matchShortcut", () => {
  let shortcuts: ShortcutDefinition[];

  beforeEach(() => {
    shortcuts = [...DEFAULT_SHORTCUTS];
  });

  it("matches simple key", () => {
    const e = makeKeyEvent("+");
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.id).toBe("zoom-in");
  });

  it("matches ctrl+key", () => {
    const e = makeKeyEvent("f", { ctrlKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("focus-search");
  });

  it("matches ctrl+g for go-to-node", () => {
    const e = makeKeyEvent("g", { ctrlKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("go-to-node");
  });

  it("matches ? for show-help", () => {
    const e = makeKeyEvent("?");
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("show-help");
  });

  it("matches Tab for cycle-focus-next", () => {
    const e = makeKeyEvent("Tab");
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("cycle-focus-next");
  });

  it("matches Shift+Tab for cycle-focus-prev", () => {
    const e = makeKeyEvent("Tab", { shiftKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("cycle-focus-prev");
  });

  it("matches Home for first-node", () => {
    const e = makeKeyEvent("Home");
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("first-node");
  });

  it("matches End for last-node", () => {
    const e = makeKeyEvent("End");
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("last-node");
  });

  it("matches Ctrl+A for select-all", () => {
    const e = makeKeyEvent("a", { ctrlKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("select-all");
  });

  it("matches Ctrl+D for deselect-all", () => {
    const e = makeKeyEvent("d", { ctrlKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("deselect-all");
  });

  it("returns null for unmatched key", () => {
    const e = makeKeyEvent("z");
    const match = matchShortcut(shortcuts, e);
    expect(match).toBeNull();
  });

  it("returns null for ctrl+key when ctrl not needed", () => {
    const e = makeKeyEvent("+", { ctrlKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).toBeNull();
  });

  it("skips shortcuts in input fields", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = makeKeyEvent("+");
    Object.defineProperty(e, "target", { value: input });
    const match = matchShortcut(shortcuts, e);
    expect(match).toBeNull();
    input.remove();
  });

  it("allows Escape in input fields", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = makeKeyEvent("Escape");
    Object.defineProperty(e, "target", { value: input });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.action).toBe("deselect");
    input.remove();
  });

  it("allows Tab in input fields", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = makeKeyEvent("Tab");
    Object.defineProperty(e, "target", { value: input });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    input.remove();
  });
});

describe("formatShortcutKey", () => {
  it("formats simple key", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "+",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("+");
  });

  it("formats ctrl+key", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "f",
      ctrl: true,
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Ctrl+F");
  });

  it("formats shift+key", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "Tab",
      shift: true,
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Shift+Tab");
  });

  it("formats arrow keys", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "ArrowUp",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("\u2191");
  });

  it("formats space key", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: " ",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Space");
  });
});

describe("groupShortcutsByCategory", () => {
  it("groups by category", () => {
    const groups = groupShortcutsByCategory(DEFAULT_SHORTCUTS);
    expect(groups.has(SHORTCUT_CATEGORIES.NAVIGATION)).toBe(true);
    expect(groups.has(SHORTCUT_CATEGORIES.VIEW)).toBe(true);
  });

  it("navigation group has multiple items", () => {
    const groups = groupShortcutsByCategory(DEFAULT_SHORTCUTS);
    const nav = groups.get(SHORTCUT_CATEGORIES.NAVIGATION)!;
    expect(nav.length).toBeGreaterThan(1);
  });
});

describe("getShortcutsForAction", () => {
  it("finds shortcuts for action", () => {
    const zoomIn = getShortcutsForAction(DEFAULT_SHORTCUTS, "zoom-in");
    expect(zoomIn.length).toBe(2);
  });

  it("returns empty for unknown action", () => {
    const result = getShortcutsForAction(DEFAULT_SHORTCUTS, "nonexistent");
    expect(result.length).toBe(0);
  });
});

describe("shortcut customization", () => {
  beforeEach(() => {
    $shortcuts.set(DEFAULT_SHORTCUTS);
  });

  it("updateShortcut changes key", () => {
    updateShortcut("zoom-in", { key: "z" });
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.key).toBe("z");
  });

  it("updateShortcut preserves other fields", () => {
    updateShortcut("zoom-in", { key: "z" });
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.description).toBe("Zoom in");
    expect(updated!.action).toBe("zoom-in");
  });

  it("updateShortcut with non-existent id is no-op", () => {
    const before = $shortcuts.get().length;
    updateShortcut("nonexistent", { key: "z" });
    expect($shortcuts.get().length).toBe(before);
  });

  it("resetShortcuts restores defaults", () => {
    updateShortcut("zoom-in", { key: "z" });
    resetShortcuts();
    const restored = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(restored!.key).toBe("+");
  });

  it("addShortcut adds new shortcut", () => {
    const before = $shortcuts.get().length;
    addShortcut({
      id: "custom",
      key: "x",
      description: "Custom",
      category: "Custom",
      action: "custom",
    });
    expect($shortcuts.get().length).toBe(before + 1);
    expect($shortcuts.get().find((s) => s.id === "custom")).toBeDefined();
  });

  it("removeShortcut removes shortcut", () => {
    const before = $shortcuts.get().length;
    removeShortcut("zoom-in");
    expect($shortcuts.get().length).toBe(before - 1);
    expect($shortcuts.get().find((s) => s.id === "zoom-in")).toBeUndefined();
  });

  it("removeShortcut with non-existent id is no-op", () => {
    const before = $shortcuts.get().length;
    removeShortcut("nonexistent");
    expect($shortcuts.get().length).toBe(before);
  });
});

describe("shortcut edge cases", () => {
  beforeEach(() => {
    $shortcuts.set(DEFAULT_SHORTCUTS);
  });

  it("matchShortcut with multiple modifiers", () => {
    const shortcuts: ShortcutDefinition[] = [
      {
        id: "test",
        key: "s",
        ctrl: true,
        shift: true,
        description: "test",
        category: "test",
        action: "test",
      },
    ];
    const e = makeKeyEvent("s", { ctrlKey: true, shiftKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
    expect(match!.id).toBe("test");
  });

  it("matchShortcut rejects partial modifier match", () => {
    const shortcuts: ShortcutDefinition[] = [
      {
        id: "test",
        key: "s",
        ctrl: true,
        shift: true,
        description: "test",
        category: "test",
        action: "test",
      },
    ];
    const e = makeKeyEvent("s", { ctrlKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).toBeNull();
  });

  it("matchShortcut handles alt modifier", () => {
    const shortcuts: ShortcutDefinition[] = [
      {
        id: "test",
        key: "x",
        alt: true,
        description: "test",
        category: "test",
        action: "test",
      },
    ];
    const e = makeKeyEvent("x", { altKey: true });
    const match = matchShortcut(shortcuts, e);
    expect(match).not.toBeNull();
  });

  it("matchShortcut returns first match for duplicate keys", () => {
    const shortcuts: ShortcutDefinition[] = [
      { id: "first", key: "a", description: "first", category: "test", action: "first" },
      { id: "second", key: "a", description: "second", category: "test", action: "second" },
    ];
    const e = makeKeyEvent("a");
    const match = matchShortcut(shortcuts, e);
    expect(match!.id).toBe("first");
  });

  it("formatShortcutKey with multiple modifiers", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "s",
      ctrl: true,
      shift: true,
      alt: true,
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Ctrl+Alt+Shift+S");
  });

  it("formatShortcutKey with Escape", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "Escape",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Esc");
  });

  it("formatShortcutKey with Enter", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "Enter",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Enter");
  });

  it("formatShortcutKey with Home", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "Home",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("Home");
  });

  it("formatShortcutKey with End", () => {
    const s: ShortcutDefinition = {
      id: "test",
      key: "End",
      description: "test",
      category: "test",
      action: "test",
    };
    expect(formatShortcutKey(s)).toBe("End");
  });

  it("groupShortcutsByCategory returns all categories", () => {
    const groups = groupShortcutsByCategory(DEFAULT_SHORTCUTS);
    expect(groups.size).toBeGreaterThan(0);
    for (const [cat, shortcuts] of groups) {
      expect(typeof cat).toBe("string");
      expect(Array.isArray(shortcuts)).toBe(true);
      expect(shortcuts.length).toBeGreaterThan(0);
    }
  });

  it("all default shortcuts have required fields", () => {
    for (const s of DEFAULT_SHORTCUTS) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.key).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(typeof s.category).toBe("string");
      expect(typeof s.action).toBe("string");
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.key.length).toBeGreaterThan(0);
    }
  });

  it("all default shortcuts have unique ids", () => {
    const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("updateShortcut can change description", () => {
    updateShortcut("zoom-in", { description: "New description" });
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.description).toBe("New description");
  });

  it("updateShortcut can change category", () => {
    updateShortcut("zoom-in", { category: "Custom" });
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.category).toBe("Custom");
  });

  it("updateShortcut can change action", () => {
    updateShortcut("zoom-in", { action: "custom-action" });
    const updated = $shortcuts.get().find((s) => s.id === "zoom-in");
    expect(updated!.action).toBe("custom-action");
  });

  it("shortcut overlay shows all shortcuts", async () => {
    const { $shortcutOverlayVisible } = await import("../src/components/shortcut-overlay.ts");
    await import("../src/components/shortcut-overlay.ts");
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const rows = el.shadowRoot!.querySelectorAll(".shortcut-row");
    expect(rows.length).toBe(DEFAULT_SHORTCUTS.length);
    $shortcutOverlayVisible.set(false);
    el.remove();
  });
});
