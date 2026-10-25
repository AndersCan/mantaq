import type { AtlasComparison } from "../schema.ts";
import ts from "typescript";

/** Names the handler uses for its event, payload and context. */
export interface HandlerScope {
  eventName: string | null;
  contextName: string | null;
  /** Local name -> payload path ("" = whole payload). */
  payloadAliases: Map<string, string>;
  /** Locals holding `context.get()`. */
  contextAliases: Set<string>;
}

export interface Reads {
  payloadReads: Set<string>;
  contextReads: Set<string>;
  contextWrites: Set<string>;
  readsActorState: boolean;
  comparisons: AtlasComparison[];
}

type Source = { source: "payload" | "context"; path: string };

const COMPARISONS = new Map<ts.SyntaxKind, AtlasComparison["operator"]>([
  [ts.SyntaxKind.LessThanToken, "<"],
  [ts.SyntaxKind.LessThanEqualsToken, "<="],
  [ts.SyntaxKind.GreaterThanToken, ">"],
  [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [ts.SyntaxKind.EqualsEqualsToken, "=="],
  [ts.SyntaxKind.ExclamationEqualsToken, "!="],
]);

const FLIPPED: Record<AtlasComparison["operator"], AtlasComparison["operator"]> = {
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
  "===": "===",
  "!==": "!==",
  "==": "==",
  "!=": "!=",
};

function unwrap(expr: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr))
    return unwrap(expr.expression);
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    return unwrap(expr.left);
  }
  return expr;
}

/** `a.b.c` -> root `a`, names `[b, c]`. */
function chainOf(expr: ts.Expression): { root: ts.Expression; names: string[] } {
  const names: string[] = [];
  let current = unwrap(expr);
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  return { root: current, names };
}

export function isContextGet(expr: ts.Expression, scope: HandlerScope): boolean {
  if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) return false;
  const target = expr.expression;
  return (
    target.name.text === "get" &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === scope.contextName
  );
}

function join(parts: ReadonlyArray<string>): string {
  return parts.filter(Boolean).join(".");
}

/** Where an expression's value comes from: the event payload, the context, or neither. */
export function classify(expr: ts.Expression, scope: HandlerScope): Source | null {
  const { root, names } = chainOf(expr);
  if (isContextGet(root, scope)) return { source: "context", path: join(names) };
  if (!ts.isIdentifier(root)) return null;
  if (root.text === scope.eventName && names[0] === "payload") {
    return { source: "payload", path: join(names.slice(1)) };
  }
  const alias = scope.payloadAliases.get(root.text);
  if (alias !== undefined) return { source: "payload", path: join([alias, ...names]) };
  if (scope.contextAliases.has(root.text)) return { source: "context", path: join(names) };
  return null;
}

function literalValue(expr: ts.Expression): number | string | boolean | undefined {
  const node = unwrap(expr);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalValue(node.operand);
    return typeof inner === "number" ? -inner : undefined;
  }
  return undefined;
}

function comparison(node: ts.BinaryExpression, scope: HandlerScope): AtlasComparison | null {
  const operator = COMPARISONS.get(node.operatorToken.kind);
  if (operator === undefined) return null;
  const rightLiteral = literalValue(node.right);
  const leftLiteral = literalValue(node.left);
  if (rightLiteral !== undefined) {
    const side = classify(node.left, scope);
    return side ? { ...side, operator, literal: rightLiteral } : null;
  }
  if (leftLiteral === undefined) return null;
  const side = classify(node.right, scope);
  return side ? { ...side, operator: FLIPPED[operator], literal: leftLiteral } : null;
}

/** Outermost access in a chain, minus a trailing method name when it is called. */
function readPath(node: ts.Expression): ts.Expression | null {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return null;
  if (
    ts.isCallExpression(parent) &&
    parent.expression === node &&
    ts.isPropertyAccessExpression(node)
  ) {
    return node.expression;
  }
  return node;
}

function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

function recordAccess(node: ts.Expression, context: { scope: HandlerScope; reads: Reads }): void {
  const target = readPath(node);
  if (target === null) return;
  const source = classify(target, context.scope);
  if (source === null) {
    const { root, names } = chainOf(target);
    if (ts.isIdentifier(root) && names[0] === "state" && root.text !== context.scope.eventName) {
      context.reads.readsActorState = true;
    }
    return;
  }
  // `const { a, b } = event.payload` reads a and b (recorded via aliases), not the whole payload.
  const destructured =
    ts.isVariableDeclaration(target.parent) && !ts.isIdentifier(target.parent.name);
  if (destructured) return;
  const path = source.path || "*";
  if (source.source === "payload") context.reads.payloadReads.add(path);
  else if (isAssignmentTarget(node)) context.reads.contextWrites.add(path);
  else if (path !== "*") context.reads.contextReads.add(path);
}

/** Walk a handler body collecting payload/context reads, context writes and comparisons. */
export function collectReads(body: ts.Node, scope: HandlerScope): Reads {
  const reads: Reads = {
    payloadReads: new Set(),
    contextReads: new Set(),
    contextWrites: new Set(),
    readsActorState: false,
    comparisons: [],
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) {
      if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression === node) {
        recordAccess(node, { scope, reads });
      }
    }
    if (ts.isBinaryExpression(node)) {
      const found = comparison(node, scope);
      if (found) reads.comparisons.push(found);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return reads;
}

export { literalValue };
