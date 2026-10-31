import ts from "typescript";

/** Replace `[start, end)` of a file with `text`. Offsets refer to the unedited file. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface Transform {
  name: string;
  /** Edits for one file. Must be idempotent: an already-migrated file yields none. */
  edits(file: ts.SourceFile, checker: ts.TypeChecker): Edit[];
}

/** Apply non-overlapping edits back to front so earlier offsets stay valid. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let result = text;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/** Every node in the file, depth first. */
export function* descendants(node: ts.Node): Generator<ts.Node> {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
  });
  for (const child of children) {
    yield child;
    yield* descendants(child);
  }
}

export function property(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find(
    (element) =>
      element.name !== undefined && ts.isIdentifier(element.name) && element.name.text === name,
  );
}

/** Options object of a builder `m.on(state, {...})` / `m.onAny({...})` call. */
export function builderOptions(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const method = node.expression.name.text;
  const argument = method === "on" ? node.arguments[1] : node.arguments[0];
  if (method !== "on" && method !== "onAny") return undefined;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return undefined;
  const receiver = checker.getTypeAtLocation(node.expression.expression);
  const names = [receiver.getSymbol(), receiver.aliasSymbol].map((symbol) => symbol?.getName());
  return names.includes("ActorBuilder") ? argument : undefined;
}
