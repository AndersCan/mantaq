import { html, render } from "lit-html";
import type { AnyActor } from "@mantaq/core";
import sharedStyles from "../styles.css?inline";
import { EditorModel } from "./editor-model";

const TYPE_BADGE_CLS: Record<string, string> = {
  string: "ctx-type ctx-type-string",
  number: "ctx-type ctx-type-number",
  boolean: "ctx-type ctx-type-boolean",
  object: "ctx-type ctx-type-object",
};

const VALUE_CLS: Record<string, string> = {
  string: "ctx-value ctx-value-string",
  number: "ctx-value ctx-value-number",
  boolean: "ctx-value ctx-value-boolean",
  object: "ctx-value",
};

export class ContextViewer extends HTMLElement {
  #actor: AnyActor | null = null;
  #model = new EditorModel();

  set actor(value: AnyActor | null) {
    this.#actor = value;
    this.#model.clear();
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

  #enterEdit(path: string[], currentValue: unknown): void {
    this.#model.enterEdit(path, currentValue);
    this.#renderAll();
    requestAnimationFrame(() => {
      const input = this.querySelector<HTMLInputElement>("input");
      input?.focus();
    });
  }

  #commitEdit(): void {
    const ctx = this.#actor?.context;
    if (!ctx || typeof ctx !== "object") return;
    const result = this.#model.commitEdit(ctx as Record<string, unknown>);

    if (result) {
      this.dispatchEvent(
        new CustomEvent("context-edit", {
          detail: { path: result.path, value: result.value },
          bubbles: true,
          composed: true,
        }),
      );
    }

    this.#renderAll();
  }

  #cancelEdit(): void {
    this.#model.cancelEdit();
    this.#renderAll();
  }

  #toggleExpand(id: string): void {
    this.#model.toggleExpand(id);
    this.#renderAll();
  }

  #renderObjectField(
    key: string,
    value: unknown,
    path: string[],
    depth: number,
  ): ReturnType<typeof html> {
    const pathId = path.join(".");
    const indentStyle = `width:${depth * 16}px`;
    const expanded = this.#model.isExpanded(pathId);
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => this.#model.detectType(v) !== null,
    );

    return html`
      <div class="ctx-row">
        <span class="ctx-indent" style=${indentStyle}></span>
        <span class="ctx-chevron" @click=${() => this.#toggleExpand(pathId)}>
          ${expanded ? "▼" : "▶"}
        </span>
        <span class="ctx-key">${key}</span>
        <span class="${TYPE_BADGE_CLS["object"]}">obj</span>
        <span class="ctx-value">${this.#model.formatValue(value, "object")}</span>
      </div>
      ${expanded
        ? entries.map(([k, v]) => this.#renderField(k, v, [...path, k], depth + 1))
        : html``}
    `;
  }

  #renderEditingBoolean(
    key: string,
    value: unknown,
    path: string[],
    depth: number,
  ): ReturnType<typeof html> {
    const indentStyle = `width:${depth * 16}px`;

    return html`
      <div class="ctx-row">
        <span class="ctx-indent" style=${indentStyle}></span>
        <span class="ctx-chevron"></span>
        <span class="ctx-key">${key}</span>
        <span class="${TYPE_BADGE_CLS["boolean"]}">bool</span>
        <button
          class="ctx-toggle"
          data-value=${String(Boolean(value))}
          @click=${() => {
            this.#model.pendingValue = String(!value);
            this.#commitEdit();
          }}
        >
          ${value ? "true" : "false"}
        </button>
      </div>
    `;
  }

  #renderEditingScalar(
    key: string,
    value: unknown,
    path: string[],
    depth: number,
  ): ReturnType<typeof html> {
    const type = this.#model.detectType(value);
    const pathId = path.join(".");
    const indentStyle = `width:${depth * 16}px`;
    const inputType = type === "number" ? "number" : "text";

    return html`
      <div class="ctx-row">
        <span class="ctx-indent" style=${indentStyle}></span>
        <span class="ctx-chevron"></span>
        <span class="ctx-key">${key}</span>
        <span class="${TYPE_BADGE_CLS[type!]}"> ${type === "string" ? "str" : "num"} </span>
        <div class="ctx-editor">
          <input
            type=${inputType}
            data-path=${pathId}
            .value=${this.#model.pendingValue}
            @input=${(e: Event) => {
              this.#model.pendingValue = (e.target as HTMLInputElement).value;
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

  #renderReadonlyScalar(
    key: string,
    value: unknown,
    path: string[],
    depth: number,
  ): ReturnType<typeof html> {
    const type = this.#model.detectType(value);
    const indentStyle = `width:${depth * 16}px`;

    return html`
      <div class="ctx-row">
        <span class="ctx-indent" style=${indentStyle}></span>
        <span class="ctx-chevron"></span>
        <span class="ctx-key">${key}</span>
        <span class="${TYPE_BADGE_CLS[type!]}">
          ${type === "string" ? "str" : type === "number" ? "num" : "bool"}
        </span>
        <span class="${VALUE_CLS[type!]}" @click=${() => this.#enterEdit(path, value)}>
          ${this.#model.formatValue(value, type!)}
        </span>
      </div>
    `;
  }

  #renderField(
    key: string,
    value: unknown,
    path: string[],
    depth: number,
  ): ReturnType<typeof html> {
    const type = this.#model.detectType(value);
    if (!type) return html``;

    if (type === "object") return this.#renderObjectField(key, value, path, depth);
    if (this.#model.isEditingPath(path)) {
      if (type === "boolean") return this.#renderEditingBoolean(key, value, path, depth);
      return this.#renderEditingScalar(key, value, path, depth);
    }
    return this.#renderReadonlyScalar(key, value, path, depth);
  }

  #renderAll(): void {
    const ctx = this.#actor?.context;
    const fields =
      ctx && typeof ctx === "object"
        ? Object.entries(ctx).filter(([, v]) => this.#model.detectType(v) !== null)
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
