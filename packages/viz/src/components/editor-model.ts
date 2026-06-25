export type RenderableType = "string" | "number" | "boolean" | "object";

export class EditorModel {
  #editingPath: string[] | null = null;
  #pendingValue = "";
  #expandedPaths = new Set<string>();

  get editingPath(): string[] | null {
    return this.#editingPath;
  }

  get pendingValue(): string {
    return this.#pendingValue;
  }

  set pendingValue(v: string) {
    this.#pendingValue = v;
  }

  detectType(value: unknown): RenderableType | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "function") return null;
    if (typeof value === "symbol") return null;
    if (Array.isArray(value)) return null;
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "object") return "object";
    return null;
  }

  formatValue(value: unknown, type: RenderableType): string {
    if (type === "string") {
      const str = String(value);
      return str.length > 60 ? `"${str.slice(0, 57)}…"` : `"${str}"`;
    }
    if (type === "number") return String(value);
    if (type === "boolean") return value ? "true" : "false";
    if (type === "object") {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => this.detectType(v) !== null,
      );
      return `{${entries.length} fields}`;
    }
    return String(value);
  }

  isEditingPath(path: string[]): boolean {
    return this.#editingPath !== null && this.#pathEq(this.#editingPath, path);
  }

  enterEdit(path: string[], currentValue: unknown): void {
    this.#editingPath = path;
    const type = this.detectType(currentValue);
    if (type === "boolean") {
      this.#pendingValue = String(Boolean(currentValue));
    } else if (type === "number") {
      this.#pendingValue = String(currentValue);
    } else {
      this.#pendingValue = typeof currentValue === "string" ? currentValue : String(currentValue);
    }
  }

  commitEdit(context: Record<string, unknown>): { path: string[]; value: unknown } | null {
    if (this.#editingPath === null) return null;
    const path = this.#editingPath;

    let oldValue: unknown = context;
    for (const part of path) {
      if (oldValue === null || oldValue === undefined || typeof oldValue !== "object") {
        oldValue = undefined;
        break;
      }
      oldValue = (oldValue as Record<string, unknown>)[part];
    }

    const type = this.detectType(oldValue);
    let newValue: unknown;

    if (type === "number") {
      const parsed = Number(this.#pendingValue);
      if (Number.isNaN(parsed)) {
        this.cancelEdit();
        return null;
      }
      newValue = parsed;
    } else if (type === "boolean") {
      newValue = this.#pendingValue === "true";
    } else {
      newValue = this.#pendingValue;
    }

    this.#setValue(context, path, newValue);
    this.#editingPath = null;
    this.#pendingValue = "";

    return { path, value: newValue };
  }

  cancelEdit(): void {
    this.#editingPath = null;
    this.#pendingValue = "";
  }

  toggleExpand(id: string): void {
    if (this.#expandedPaths.has(id)) {
      this.#expandedPaths.delete(id);
    } else {
      this.#expandedPaths.add(id);
    }
  }

  isExpanded(id: string): boolean {
    return this.#expandedPaths.has(id);
  }

  clear(): void {
    this.#expandedPaths.clear();
    this.#editingPath = null;
    this.#pendingValue = "";
  }

  #pathEq(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  #setValue(context: Record<string, unknown>, path: string[], value: unknown): void {
    let current: Record<string, unknown> = context;
    for (let i = 0; i < path.length - 1; i++) {
      const next = current[path[i]!];
      if (next === null || next === undefined || typeof next !== "object") {
        return;
      }
      current = next as Record<string, unknown>;
    }
    current[path[path.length - 1]!] = value;
  }
}
