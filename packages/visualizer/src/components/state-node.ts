import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

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

  static styles = css`
    :host {
      display: block;
      position: absolute;
      cursor: pointer;
      user-select: none;
    }
    .node {
      padding: 8px 16px;
      border: 2px solid #666;
      border-radius: 8px;
      background: white;
      text-align: center;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      transition: all 0.2s ease;
      min-width: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      box-sizing: border-box;
    }
    .node.active {
      border-color: #4caf50;
      background: #e8f5e9;
      box-shadow: 0 0 8px rgba(76, 175, 80, 0.3);
    }
    .node.final {
      border-width: 4px;
      border-style: double;
    }
    .node.selected {
      border-color: #2196f3;
      box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.3);
    }
    .label {
      font-weight: 500;
      color: #333;
      pointer-events: none;
    }
  `;

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
