/** The drawing of the `tallScreenParts` fixture, for the frame page: gives the Step panel a Screen tab. */
export default function draw(element: HTMLElement, state: { name: string }): void {
  element.textContent = `chain is at ${state.name}`;
}
