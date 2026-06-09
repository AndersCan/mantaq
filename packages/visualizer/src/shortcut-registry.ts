import { atom } from "nanostores";

export interface ShortcutDefinition {
  id: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  category: string;
  action: string;
  when?: string;
}

export const SHORTCUT_CATEGORIES = {
  NAVIGATION: "Navigation",
  VIEW: "View",
  SELECTION: "Selection",
  SEARCH: "Search",
  GENERAL: "General",
} as const;

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "zoom-in",
    key: "+",
    description: "Zoom in",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "zoom-in",
  },
  {
    id: "zoom-in-alt",
    key: "=",
    description: "Zoom in (alt)",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "zoom-in",
  },
  {
    id: "zoom-out",
    key: "-",
    description: "Zoom out",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "zoom-out",
  },
  {
    id: "reset-view",
    key: "0",
    description: "Reset view",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "reset-view",
  },
  {
    id: "zoom-to-fit",
    key: "f",
    description: "Zoom to fit",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "zoom-to-fit",
  },
  {
    id: "toggle-minimap",
    key: "m",
    description: "Toggle minimap",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "toggle-minimap",
  },
  {
    id: "next-node",
    key: "ArrowRight",
    description: "Select next node",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "next-node",
  },
  {
    id: "next-node-down",
    key: "ArrowDown",
    description: "Select next node (alt)",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "next-node",
  },
  {
    id: "prev-node",
    key: "ArrowLeft",
    description: "Select previous node",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "prev-node",
  },
  {
    id: "prev-node-up",
    key: "ArrowUp",
    description: "Select previous node (alt)",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "prev-node",
  },
  {
    id: "first-node",
    key: "Home",
    description: "Select first node",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "first-node",
  },
  {
    id: "last-node",
    key: "End",
    description: "Select last node",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "last-node",
  },
  {
    id: "deselect",
    key: "Escape",
    description: "Deselect node / close dialog",
    category: SHORTCUT_CATEGORIES.SELECTION,
    action: "deselect",
  },
  {
    id: "select-all",
    key: "a",
    ctrl: true,
    description: "Select all nodes",
    category: SHORTCUT_CATEGORIES.SELECTION,
    action: "select-all",
  },
  {
    id: "deselect-all",
    key: "d",
    ctrl: true,
    description: "Deselect all nodes",
    category: SHORTCUT_CATEGORIES.SELECTION,
    action: "deselect-all",
  },
  {
    id: "activate-node",
    key: "Enter",
    description: "Activate / open selected node",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "activate-node",
  },
  {
    id: "activate-node-space",
    key: " ",
    description: "Activate / open selected node",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "activate-node",
  },
  {
    id: "focus-search",
    key: "f",
    ctrl: true,
    description: "Focus search bar",
    category: SHORTCUT_CATEGORIES.SEARCH,
    action: "focus-search",
  },
  {
    id: "focus-search-slash",
    key: "/",
    description: "Focus search bar",
    category: SHORTCUT_CATEGORIES.SEARCH,
    action: "focus-search",
  },
  {
    id: "go-to-node",
    key: "g",
    ctrl: true,
    description: "Go to node by name",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "go-to-node",
  },
  {
    id: "show-help",
    key: "?",
    description: "Show keyboard shortcuts",
    category: SHORTCUT_CATEGORIES.GENERAL,
    action: "show-help",
  },
  {
    id: "toggle-history",
    key: "h",
    description: "Toggle history panel",
    category: SHORTCUT_CATEGORIES.VIEW,
    action: "toggle-history",
  },
  {
    id: "replay-prev",
    key: "[",
    description: "Previous history entry",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "replay-prev",
  },
  {
    id: "replay-next",
    key: "]",
    description: "Next history entry",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "replay-next",
  },
  {
    id: "cycle-focus-next",
    key: "Tab",
    description: "Focus next interactive element",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "cycle-focus-next",
  },
  {
    id: "cycle-focus-prev",
    key: "Tab",
    shift: true,
    description: "Focus previous interactive element",
    category: SHORTCUT_CATEGORIES.NAVIGATION,
    action: "cycle-focus-prev",
  },
];

export interface ShortcutMatch {
  shortcut: ShortcutDefinition;
}

export function matchShortcut(
  shortcuts: ShortcutDefinition[],
  e: KeyboardEvent,
): ShortcutDefinition | null {
  const target = e.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const allowInInput = ["Escape", "Tab"];
    if (!allowInInput.includes(e.key)) return null;
  }

  for (const s of shortcuts) {
    const keyMatch = s.key === e.key || s.key.toLowerCase() === e.key.toLowerCase();
    if (!keyMatch) continue;

    const ctrlNeeded = s.ctrl ?? false;
    const shiftNeeded = s.shift ?? false;
    const altNeeded = s.alt ?? false;
    const metaNeeded = s.meta ?? false;

    if (ctrlNeeded !== (e.ctrlKey || e.metaKey)) continue;
    if (shiftNeeded !== e.shiftKey) continue;
    if (altNeeded !== e.altKey) continue;
    if (metaNeeded !== e.metaKey && !ctrlNeeded) continue;

    return s;
  }
  return null;
}

export function formatShortcutKey(s: ShortcutDefinition): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.meta) parts.push("Cmd");
  if (s.alt) parts.push("Alt");
  if (s.shift) parts.push("Shift");

  const keyDisplay: Record<string, string> = {
    " ": "Space",
    ArrowUp: "\u2191",
    ArrowDown: "\u2193",
    ArrowLeft: "\u2190",
    ArrowRight: "\u2192",
    Escape: "Esc",
    Enter: "Enter",
    Tab: "Tab",
    Home: "Home",
    End: "End",
  };

  parts.push(keyDisplay[s.key] ?? s.key.toUpperCase());
  return parts.join("+");
}

export function groupShortcutsByCategory(
  shortcuts: readonly ShortcutDefinition[],
): Map<string, ShortcutDefinition[]> {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const s of shortcuts) {
    const existing = groups.get(s.category) ?? [];
    existing.push(s);
    groups.set(s.category, existing);
  }
  return groups;
}

export function getShortcutsForAction(
  shortcuts: ShortcutDefinition[],
  action: string,
): ShortcutDefinition[] {
  return shortcuts.filter((s) => s.action === action);
}

export const $shortcuts = atom<ShortcutDefinition[]>(DEFAULT_SHORTCUTS);

export function updateShortcut(id: string, updates: Partial<ShortcutDefinition>): void {
  const current = $shortcuts.get();
  const idx = current.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const updated = [...current];
  updated[idx] = { ...updated[idx], ...updates };
  $shortcuts.set(updated);
}

export function resetShortcuts(): void {
  $shortcuts.set(DEFAULT_SHORTCUTS);
}

export function addShortcut(shortcut: ShortcutDefinition): void {
  $shortcuts.set([...$shortcuts.get(), shortcut]);
}

export function removeShortcut(id: string): void {
  $shortcuts.set($shortcuts.get().filter((s) => s.id !== id));
}
