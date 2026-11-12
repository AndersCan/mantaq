/** Only the types matter here: the analysis reads them and never calls this. */
export function createShapes(): {
  send(
    event:
      | { type: string; payload: { wide: number } }
      | { type: "shapes.GO"; payload: void }
      | { type: "shapes.PLAIN" }
      | { type: "shapes.PICK"; payload: { n: number } },
  ): void;
  snapshot(): unknown;
  inject(): void;
  settled(): Promise<void>;
} {
  throw new Error("not run");
}
