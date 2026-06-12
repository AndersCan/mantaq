import { html, render } from "lit-html";
import type { AnyActor } from "@mantaq/core";

type RenderableType = "string" | "number" | "boolean" | "object";

export class ContextViewer extends HTMLElement {
  #actor: AnyActor | null = null;
  #editingPath: string[] | null = null;
  #pendingValue = "";
  #expandedPaths = new Set<string>();

  set actor(value: AnyActor | null) {
    this.#actor = value;
    this.#expandedPaths.clear();
    this.#editingPath = null;
    this.#pendingValue = "";
    this.#renderAll();
  }

  get actor(): AnyActor | null {
    return this.#actor;
  }

  connectedCallback(): void {
    this.#renderAll();
  }

  disconnectedCallback(): void {
    render("", this);
  }

  #detectType(value: unknown): RenderableType | null {
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

  #resolveValue(path: string[]): unknown {
    const ctx = this.#actor?.context;
    if (!ctx || typeof ctx !== "object") return undefined;
    let current: unknown = ctx;
    for (const part of path) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  #setValue(path: string[], value: unknown): void {
    const ctx = this.#actor?.context;
    if (!ctx || typeof ctx !== "object") return;
    let current: Record<string, unknown> = ctx;
    for (let i = 0; i < path.length - 1; i++) {
      const next = current[path[i]!];
      if (next === null || next === undefined || typeof next !== "object") {
        return;
      }
      current = next as Record<string, unknown>;
    }
    current[path[path.length - 1]!] = value;
  }

  #enterEdit(path: string[], currentValue: unknown): void {
    this.#editingPath = path;
    const type = this.#detectType(currentValue);
    if (type === "boolean") {
      this.#pendingValue = String(Boolean(currentValue));
    } else if (type === "number") {
      this.#pendingValue = String(currentValue);
    } else {
      this.#pendingValue = typeof currentValue === "string" ? currentValue : String(currentValue);
    }
    this.#renderAll();
    requestAnimationFrame(() => {
      const input = this.querySelector<HTMLInputElement>("input");
      input?.focus();
    });
  }

  #commitEdit(): void {
    if (this.#editingPath === null) return;
    const path = this.#editingPath;
    const oldValue = this.#resolveValue(path);
    const type = this.#detectType(oldValue);
    let newValue: unknown;

    if (type === "number") {
      const parsed = Number(this.#pendingValue);
      if (Number.isNaN(parsed)) {
        this.#cancelEdit();
        return;
      }
      newValue = parsed;
    } else if (type === "boolean") {
      newValue = this.#pendingValue === "true";
    } else {
      newValue = this.#pendingValue;
    }

    this.#setValue(path, newValue);
    this.#editingPath = null;
    this.#pendingValue = "";

    this.dispatchEvent(
      new CustomEvent("context-edit", {
        detail: { path, value: newValue },
        bubbles: true,
        composed: true,
      }),
    );

    this.#renderAll();
  }

  #cancelEdit(): void {
    this.#editingPath = null;
    this.#pendingValue = "";
    this.#renderAll();
  }

  #toggleExpand(id: string): void {
    if (this.#expandedPaths.has(id)) {
      this.#expandedPaths.delete(id);
    } else {
      this.#expandedPaths.add(id);
    }
    this.#renderAll();
  }

  #formatValue(value: unknown, type: RenderableType): string {
    if (type === "string") {
      const str = String(value);
      return str.length > 60 ? `"${str.slice(0, 57)}…"` : `"${str}"`;
    }
    if (type === "number") return String(value);
    if (type === "boolean") return value ? "true" : "false";
    if (type === "object") {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => this.#detectType(v) !== null,
      );
      return `{${entries.length} fields}`;
    }
    return String(value);
  }

  #pathEq(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  #renderField(
    key: string,
    value: unknown,
    path: string[],
    depth: number,
  ): ReturnType<typeof html> {
    const type = this.#detectType(value);
    if (!type) return html``;

    const pathId = path.join(".");

    if (type === "object") {
      const expanded = this.#expandedPaths.has(pathId);
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => this.#detectType(v) !== null,
      );

      return html`
        <div class="ctx-row">
          <span class="ctx-indent" style="width:${depth * 16}px"></span>
          <span class="ctx-chevron" @click=${() => this.#toggleExpand(pathId)}>
            ${expanded ? "▼" : "▶"}
          </span>
          <span class="ctx-key">${key}</span>
          <span class="ctx-type ctx-type-object">obj</span>
          <span class="ctx-value">${this.#formatValue(value, type)}</span>
        </div>
        ${expanded
          ? entries.map(([k, v]) => this.#renderField(k, v, [...path, k], depth + 1))
          : html``}
      `;
    }

    const isEditing = this.#editingPath !== null && this.#pathEq(this.#editingPath, path);
    const badgeClass =
      type === "string"
        ? "ctx-type-string"
        : type === "number"
          ? "ctx-type-number"
          : "ctx-type-boolean";
    const valueClass =
      type === "string"
        ? "ctx-value-string"
        : type === "number"
          ? "ctx-value-number"
          : "ctx-value-boolean";

    if (isEditing && type === "boolean") {
      return html`
        <div class="ctx-row">
          <span class="ctx-indent" style="width:${depth * 16}px"></span>
          <span class="ctx-chevron"></span>
          <span class="ctx-key">${key}</span>
          <span class="ctx-type ${badgeClass}">bool</span>
          <button
            class="ctx-toggle"
            data-value=${String(Boolean(value))}
            @click=${() => {
              this.#pendingValue = String(!value);
              this.#commitEdit();
            }}
          >
            ${value ? "true" : "false"}
          </button>
        </div>
      `;
    }

    if (isEditing) {
      const inputType = type === "number" ? "number" : "text";
      return html`
        <div class="ctx-row">
          <span class="ctx-indent" style="width:${depth * 16}px"></span>
          <span class="ctx-chevron"></span>
          <span class="ctx-key">${key}</span>
          <span class="ctx-type ${badgeClass}"> ${type === "string" ? "str" : "num"} </span>
          <div class="ctx-editor">
            <input
              type=${inputType}
              data-path=${pathId}
              .value=${this.#pendingValue}
              @input=${(e: Event) => {
                this.#pendingValue = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") this.#commitEdit();
                if (e.key === "Escape") this.#cancelEdit();
              }}
            />
            <span class="btns">
              <button class="ctx-btn-ok" @click=${() => this.#commitEdit()}>✓</button>
              <button class="ctx-btn-cancel" @click=${() => this.#cancelEdit()}>✗</button>
            </span>
          </div>
        </div>
      `;
    }

    return html`
      <div class="ctx-row">
        <span class="ctx-indent" style="width:${depth * 16}px"></span>
        <span class="ctx-chevron"></span>
        <span class="ctx-key">${key}</span>
        <span class="ctx-type ${badgeClass}">
          ${type === "string" ? "str" : type === "number" ? "num" : "bool"}
        </span>
        <span class="ctx-value ${valueClass}" @click=${() => this.#enterEdit(path, value)}>
          ${this.#formatValue(value, type)}
        </span>
      </div>
    `;
  }

  #renderAll(): void {
    const ctx = this.#actor?.context;
    const fields =
      ctx && typeof ctx === "object"
        ? Object.entries(ctx).filter(([, v]) => this.#detectType(v) !== null)
        : [];

    render(
      html`
        <style>
          :host {
            display: block;
            font-family: ui-monospace, SFMono-Regular, monospace;
          }
          .ctx-panel {
            background: var(--viz-context-bg, #f8fafc);
            border-top: 1px solid var(--viz-context-border, #e2e8f0);
            max-height: 300px;
            overflow-y: auto;
          }
          .ctx-header {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--viz-text-muted, #6b7280);
            padding: 0.5rem 0.75rem;
            border-bottom: 1px solid var(--viz-context-border, #e2e8f0);
            font-weight: 600;
          }
          .ctx-row {
            display: flex;
            align-items: center;
            padding: 0.25rem 0.75rem;
            gap: 0.5rem;
            min-height: 1.75rem;
            font-size: 0.8rem;
          }
          .ctx-row:hover {
            background: rgba(0, 0, 0, 0.03);
          }
          .ctx-indent {
            flex-shrink: 0;
          }
          .ctx-chevron {
            width: 1rem;
            text-align: center;
            cursor: pointer;
            color: var(--viz-text-muted, #6b7280);
            flex-shrink: 0;
            user-select: none;
          }
          .ctx-key {
            font-weight: 600;
            color: var(--viz-text, #1f2937);
            min-width: 80px;
          }
          .ctx-type {
            font-size: 0.65rem;
            padding: 0.1rem 0.35rem;
            border-radius: 3px;
            text-transform: uppercase;
            font-weight: 600;
            flex-shrink: 0;
          }
          .ctx-type-string {
            background: #dcfce7;
            color: #166534;
          }
          .ctx-type-number {
            background: #dbeafe;
            color: #1e40af;
          }
          .ctx-type-boolean {
            background: #fef3c7;
            color: #92400e;
          }
          .ctx-type-object {
            background: #f3e8ff;
            color: #6b21a8;
          }
          .ctx-value {
            color: var(--viz-context-text, #475569);
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
          }
          .ctx-value-string {
            color: #16a34a;
          }
          .ctx-value-number {
            color: #2563eb;
          }
          .ctx-value-boolean {
            color: #d97706;
          }
          .ctx-editor {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            flex: 1;
          }
          .ctx-editor input {
            font-family: inherit;
            font-size: 0.8rem;
            padding: 0.2rem 0.4rem;
            border: 1px solid var(--viz-context-border, #e2e8f0);
            border-radius: 3px;
            background: var(--viz-panel-bg, #ffffff);
            color: var(--viz-text, #1f2937);
            outline: none;
            flex: 1;
          }
          .ctx-editor input:focus {
            border-color: var(--viz-accent, #6366f1);
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
          }
          .ctx-editor .btns {
            display: flex;
            gap: 0.2rem;
          }
          .ctx-editor button {
            font-size: 0.75rem;
            padding: 0.15rem 0.35rem;
            border: 1px solid var(--viz-context-border, #e2e8f0);
            border-radius: 3px;
            background: var(--viz-panel-bg, #ffffff);
            cursor: pointer;
            color: var(--viz-text, #1f2937);
          }
          .ctx-editor button:hover {
            background: var(--viz-context-bg, #f8fafc);
          }
          .ctx-btn-ok {
            color: #16a34a !important;
            border-color: #86efac !important;
          }
          .ctx-btn-ok:hover {
            background: #dcfce7 !important;
          }
          .ctx-btn-cancel {
            color: #dc2626 !important;
            border-color: #fca5a5 !important;
          }
          .ctx-btn-cancel:hover {
            background: #fef2f2 !important;
          }
          .ctx-toggle {
            padding: 0.15rem 0.5rem;
            border: 1px solid;
            border-radius: 3px;
            background: transparent;
            cursor: pointer;
            font-family: inherit;
            font-size: 0.8rem;
          }
          .ctx-toggle[data-value="true"] {
            background: #dcfce7;
            border-color: #22c55e;
            color: #166534;
          }
          .ctx-toggle[data-value="false"] {
            background: #fef2f2;
            border-color: #fca5a5;
            color: #991b1b;
          }
          .ctx-empty {
            padding: 0.75rem;
            color: var(--viz-text-muted, #6b7280);
            font-size: 0.8rem;
            text-align: center;
          }
        </style>
        <div class="ctx-panel">
          <div class="ctx-header">Context</div>
          <div class="ctx-body">
            ${fields.length === 0
              ? html`<div class="ctx-empty">No context fields</div>`
              : fields.map(([k, v]) => this.#renderField(k, v, [k], 0))}
          </div>
        </div>
      `,
      this,
    );
  }
}

customElements.define("mantaq-context-viewer", ContextViewer);
