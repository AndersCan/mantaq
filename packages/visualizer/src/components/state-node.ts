import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { stateNodeStyles } from "../styles.ts";

@customElement("state-node")
export class StateNode extends LitElement {
  @property({ type: String }) nodeId = "";
  @property({ type: String }) label = "";
  @property({ type: Boolean }) isActive = false;
  @property({ type: Boolean }) isFinal = false;
  @property({ type: Boolean }) isSelected = false;
  @property({ type: Number }) xPos = 0;
  @property({ type: Number }) yPos = 0;
  @property({ type: Number }) nodeWidth = 120;
  @property({ type: Number }) nodeHeight = 60;
  @property({ type: Array }) transitions: string[] = [];

  static styles = [
    css`
      :host {
        display: block;
        position: absolute;
        cursor: pointer;
        user-select: none;
      }
      .transitions {
        display: flex;
        gap: 2px;
        margin-top: 4px;
        justify-content: center;
      }
      .transition-btn {
        font-size: 9px;
        padding: 1px 4px;
        border: 1px solid #ccc;
        border-radius: 3px;
        background: #f5f5f5;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 55px;
      }
      .transition-btn:hover {
        background: #e0e0e0;
      }
      .transition-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,
    stateNodeStyles,
  ];

  private handleClick = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("node-select", {
        detail: { nodeId: this.nodeId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private handleTransition = (e: Event, transitionId: string) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("transition-trigger", {
        detail: { nodeId: this.nodeId, transitionId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    const classes = ["node"];
    if (this.isActive) classes.push("active");
    if (this.isFinal) classes.push("final");
    if (this.isSelected) classes.push("selected");

    const tooltip = [this.nodeId, this.isActive ? "(active)" : "", this.isFinal ? "(final)" : ""]
      .filter(Boolean)
      .join(" ");

    return html`
      <div
        class="${classes.join(" ")}"
        style="width: ${this.nodeWidth}px; height: ${this.nodeHeight}px; left: ${this
          .xPos}px; top: ${this.yPos}px;"
        title="${tooltip}"
        @click=${this.handleClick}
      >
        <span class="label">${this.label}</span>
        ${this.transitions.length > 0
          ? html`
              <div class="transitions">
                ${this.transitions.map(
                  (t) => html`
                    <button
                      class="transition-btn"
                      ?disabled=${!this.isActive}
                      @click=${(e: Event) => this.handleTransition(e, t)}
                      title="Send ${t}"
                    >
                      ${t}
                    </button>
                  `,
                )}
              </div>
            `
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "state-node": StateNode;
  }
}
