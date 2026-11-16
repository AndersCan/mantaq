/** Test helper: send `event` as a person does, by opening an arrow's Details with its `?` and pressing Send there. Without `event`, any next arrow. Returns whether a Send button was pressed. */
export function sendVia(root: Element, event?: string): boolean {
  for (const edge of root.querySelectorAll(".graph g[data-details-edge]")) {
    edge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const send = [...root.querySelectorAll<HTMLButtonElement>("[data-send-edge]")].find(
      (button) => event === undefined || button.textContent.split(" ")[1] === event,
    );
    if (send !== undefined) {
      send.click();
      return true;
    }
  }
  return false;
}
