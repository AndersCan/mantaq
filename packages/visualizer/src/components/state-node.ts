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

  static styles = [
    css`
      :host {
        display: block;
        position: absolute;
        cursor: pointer;
        user-select: none;
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

  render() {
    const classes = ["node"];
    if (this.isActive) classes.push("active");
    if (this.isFinal) classes.push("final");
    if (this.isSelected) classes.push("selected");

    return html`
      <div
        class="${classes.join(" ")}"
        style="width: ${this.nodeWidth}px; height: ${this.nodeHeight}px; left: ${this
          .xPos}px; top: ${this.yPos}px;"
        @click=${this.handleClick}
      >
        <span class="label">${this.label}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "state-node": StateNode;
  }
}
