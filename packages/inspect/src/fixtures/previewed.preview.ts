/** The drawing of the `previewed` fixture, for the frame page. */
export default function draw(element: HTMLElement, state: { name: string }): void {
  element.textContent = `door is ${state.name}`;
}
