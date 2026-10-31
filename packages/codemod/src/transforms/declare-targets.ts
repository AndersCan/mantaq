import ts from "typescript";
import { builderOptions, descendants, property } from "../edits.ts";
import type { Edit, Transform } from "../edits.ts";

/** States a handler can return, read from its inferred return type. `wide` = not a literal name. */
interface Targets {
  names: Set<string>;
  wide: boolean;
}

function members(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

function propertyType(
  checker: ts.TypeChecker,
  at: { type: ts.Type; name: string },
): ts.Type | undefined {
  const symbol = checker.getPropertyOfType(at.type, at.name);
  return symbol && checker.getNonNullableType(checker.getTypeOfSymbol(symbol));
}

/** Add the state names of a `state` value: a `StateRef`, or `{ state: StateRef; payload }`. */
function collectState(checker: ts.TypeChecker, at: { type: ts.Type; targets: Targets }): void {
  for (const member of members(at.type)) {
    if (member.flags & ts.TypeFlags.Never) continue;
    const name = propertyType(checker, { type: member, name: "name" });
    if (name === undefined) {
      const nested = propertyType(checker, { type: member, name: "state" });
      if (nested === undefined) at.targets.wide = true;
      else collectState(checker, { type: nested, targets: at.targets });
      continue;
    }
    for (const literal of members(name)) {
      if (literal.isStringLiteral()) at.targets.names.add(literal.value);
      else at.targets.wide = true;
    }
  }
}

function handlerExpression(options: ts.ObjectLiteralExpression): ts.Node | undefined {
  const element = property(options, "handler");
  if (element === undefined) return undefined;
  if (ts.isPropertyAssignment(element)) return element.initializer;
  return ts.isShorthandPropertyAssignment(element) ? element.name : element;
}

function handlerTargets(checker: ts.TypeChecker, handler: ts.Node): Targets {
  const targets: Targets = { names: new Set(), wide: false };
  const signature = checker.getTypeAtLocation(handler).getCallSignatures()[0];
  if (signature === undefined) return { names: targets.names, wide: true };
  for (const result of members(checker.getReturnTypeOfSignature(signature))) {
    const state = propertyType(checker, { type: result, name: "state" });
    if (state !== undefined) collectState(checker, { type: state, targets });
  }
  return targets;
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrap(expression.expression);
  }
  return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

function arrayOf(checker: ts.TypeChecker, value: ts.Expression): ts.ArrayLiteralExpression | null {
  const expression = unwrap(value);
  if (ts.isArrayLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return null;
  const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
  const initializer =
    declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
  return initializer ? arrayOf(checker, initializer) : null;
}

/** The `states: [...]` array of the `Actor({ states, setup })` options enclosing `node`. */
function declaredStates(checker: ts.TypeChecker, node: ts.Node): ts.ArrayLiteralExpression | null {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isObjectLiteralExpression(current) || !property(current, "setup")) continue;
    const states = property(current, "states");
    if (states && ts.isPropertyAssignment(states)) return arrayOf(checker, states.initializer);
    if (states && ts.isShorthandPropertyAssignment(states)) return arrayOf(checker, states.name);
  }
  return null;
}

/** State name -> source text of the expression that declares it, in declaration order. */
function stateExpressions(checker: ts.TypeChecker, node: ts.Node): Map<string, string> {
  const expressions = new Map<string, string>();
  for (const element of declaredStates(checker, node)?.elements ?? []) {
    const name = propertyType(checker, { type: checker.getTypeAtLocation(element), name: "name" });
    if (name?.isStringLiteral() && !expressions.has(name.value)) {
      expressions.set(name.value, element.getText());
    }
  }
  return expressions;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  return ts.isPropertyAccessExpression(expression)
    ? rootIdentifier(expression.expression)
    : undefined;
}

/** True when `expression` only names bindings declared outside `scope`, so it can move out of it. */
function boundOutside(
  checker: ts.TypeChecker,
  at: { expression: ts.Expression; scope: ts.Node },
): boolean {
  const root = rootIdentifier(at.expression);
  const declaration = root && checker.getSymbolAtLocation(root)?.declarations?.[0];
  if (declaration === undefined) return false;
  return declaration.pos < at.scope.pos || declaration.end > at.scope.end;
}

/** Fallback: `state: x` expressions inside the handler, keyed by state name, when `x` is in scope outside. */
function returnedExpressions(checker: ts.TypeChecker, handler: ts.Node): Map<string, string> {
  const expressions = new Map<string, string>();
  for (const node of descendants(handler)) {
    if (!ts.isPropertyAssignment(node) || node.name.getText() !== "state") continue;
    const expression = unwrap(node.initializer);
    const name = propertyType(checker, {
      type: checker.getTypeAtLocation(expression),
      name: "name",
    });
    if (!name?.isStringLiteral() || expressions.has(name.value)) continue;
    if (boundOutside(checker, { expression, scope: handler })) {
      expressions.set(name.value, expression.getText());
    }
  }
  return expressions;
}

/** Text of the `to` list. Unresolvable targets become a comment: `vp check` then fails at that call. */
function toList(targets: Targets, expressions: Map<string, string>): string {
  const resolved = [...expressions].filter(([name]) => targets.names.has(name)).map(([, t]) => t);
  const missing = [...targets.names].filter((name) => !expressions.has(name)).sort();
  if (targets.wide) missing.push("<non-literal state>");
  const note = missing.length > 0 ? [`/* codemod: unresolved ${missing.join(", ")} */`] : [];
  return `[${[...resolved, ...note].join(", ")}]`;
}

/** Add `to: [...]` listing every state the handler can return, so the builder carries the graph. */
export const declareTargets: Transform = {
  name: "declare-targets",
  edits(file, checker) {
    const edits: Edit[] = [];
    for (const node of descendants(file)) {
      const options = builderOptions(node, checker);
      const anchor = options && (property(options, "event") ?? property(options, "eventRef"));
      const handler = options && handlerExpression(options);
      if (!anchor || !handler || property(options, "to")) continue;
      const targets = handlerTargets(checker, handler);
      if (targets.names.size === 0 && !targets.wide) continue;
      const expressions = stateExpressions(checker, options);
      for (const [name, text] of returnedExpressions(checker, handler)) {
        if (!expressions.has(name)) expressions.set(name, text);
      }
      const text = `, to: ${toList(targets, expressions)}`;
      edits.push({ start: anchor.end, end: anchor.end, text });
    }
    return edits;
  },
};
