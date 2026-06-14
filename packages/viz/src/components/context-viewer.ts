import { html, render } from "lit-html";
import type { AnyActor } from "@mantaq/core";
import sharedStyles from "../styles.css?inline";

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
    const indentStyle = `width:${depth * 16}px`;

    const typeBadgeCls: Record<string, string> = {
      string: "ctx-type ctx-type-string",
      number: "ctx-type ctx-type-number",
      boolean: "ctx-type ctx-type-boolean",
      object: "ctx-type ctx-type-object",
    };
    const valueCls: Record<string, string> = {
      string: "ctx-value ctx-value-string",
      number: "ctx-value ctx-value-number",
      boolean: "ctx-value ctx-value-boolean",
      object: "ctx-value",
    };

    if (type === "object") {
      const expanded = this.#expandedPaths.has(pathId);
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => this.#detectType(v) !== null,
      );

      return html`
        <div class="ctx-row">
          <span class="ctx-indent" style=${indentStyle}></span>
          <span class="ctx-chevron" @click=${() => this.#toggleExpand(pathId)}>
            ${expanded ? "▼" : "▶"}
          </span>
          <span class="ctx-key">${key}</span>
          <span class="${typeBadgeCls[type]}">obj</span>
          <span class="ctx-value">${this.#formatValue(value, type)}</span>
        </div>
        ${expanded
          ? entries.map(([k, v]) => this.#renderField(k, v, [...path, k], depth + 1))
          : html``}
      `;
    }

    const isEditing = this.#editingPath !== null && this.#pathEq(this.#editingPath, path);

    if (isEditing && type === "boolean") {
      return html`
        <div class="ctx-row">
          <span class="ctx-indent" style=${indentStyle}></span>
          <span class="ctx-chevron"></span>
          <span class="ctx-key">${key}</span>
          <span class="${typeBadgeCls[type]}">bool</span>
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
          <span class="ctx-indent" style=${indentStyle}></span>
          <span class="ctx-chevron"></span>
          <span class="ctx-key">${key}</span>
          <span class="${typeBadgeCls[type]}"> ${type === "string" ? "str" : "num"} </span>
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
        <span class="ctx-indent" style=${indentStyle}></span>
        <span class="ctx-chevron"></span>
        <span class="ctx-key">${key}</span>
        <span class="${typeBadgeCls[type]}">
          ${type === "string" ? "str" : type === "number" ? "num" : "bool"}
        </span>
        <span class="${valueCls[type]}" @click=${() => this.#enterEdit(path, value)}>
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
          ${sharedStyles} :host {
            display: block;
            font-family: ui-monospace, SFMono-Regular, monospace;
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
