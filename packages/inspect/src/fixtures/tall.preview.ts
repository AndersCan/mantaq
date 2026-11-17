/** The drawing of the `tall` fixture, for the frame page. */
export default function draw(element: HTMLElement, state: { name: string }): void {
  element.textContent = `chain is at ${state.name}`;
}
