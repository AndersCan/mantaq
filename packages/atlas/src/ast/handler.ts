import type { AtlasBranch, AtlasBranchTarget, AtlasExplanation } from "../schema.ts";
import { literalProperty, locationOf } from "./program.ts";
import type { Registration } from "./program.ts";
import { classify, collectReads, isContextGet, literalValue } from "./reads.ts";
import type { HandlerScope } from "./reads.ts";
import ts from "typescript";

type HandlerFunction = ts.ArrowFunction | ts.FunctionExpression;

interface Walk {
  checker: ts.TypeChecker;
  branches: AtlasBranch[];
  /** Return statements reached by the walker; compared against all returns in the body. */
  returnsSeen: number;
  conditions: ts.Expression[];
}

const SNIPPET_LINES = 4;

function text(node: ts.Node): string {
  return node.getText().replace(/\s+/g, " ");
}

function snippet(node: ts.Node): string {
  return node.getText().split("\n").slice(0, SNIPPET_LINES).join("\n");
}

function negate(condition: string): string {
  return `!(${condition})`;
}

function stateTarget(checker: ts.TypeChecker, expr: ts.Expression): AtlasBranchTarget {
  const name = literalProperty(checker, expr, "name");
  return name === null ? { kind: "unresolved", text: text(expr) } : { kind: "state", state: name };
}

function stateProperty(literal: ts.ObjectLiteralExpression): ts.Expression | undefined {
  for (const element of literal.properties) {
    if (!element.name || !ts.isIdentifier(element.name) || element.name.text !== "state") continue;
    if (ts.isPropertyAssignment(element)) return element.initializer;
    if (ts.isShorthandPropertyAssignment(element)) return element.name;
  }
  return undefined;
}

/** Split a returned expression into branches: ternaries fork, object literals end a path. */
function branchesOf(
  expr: ts.Expression | undefined,
  at: { walk: Walk; conditions: string[] },
): void {
  const { walk, conditions } = at;
  if (expr === undefined) {
    walk.branches.push({ conditions, target: { kind: "stay" } });
    return;
  }
  if (ts.isParenthesizedExpression(expr)) return branchesOf(expr.expression, at);
  if (ts.isConditionalExpression(expr)) {
    walk.conditions.push(expr.condition);
    const condition = text(expr.condition);
    branchesOf(expr.whenTrue, { walk, conditions: [...conditions, condition] });
    branchesOf(expr.whenFalse, { walk, conditions: [...conditions, negate(condition)] });
    return;
  }
  if (!ts.isObjectLiteralExpression(expr)) {
    walk.branches.push({ conditions, target: { kind: "unresolved", text: text(expr) } });
    return;
  }
  const state = stateProperty(expr);
  if (state === undefined) {
    walk.branches.push({ conditions, target: { kind: "stay" } });
    return;
  }
  if (ts.isConditionalExpression(state)) {
    walk.conditions.push(state.condition);
    const condition = text(state.condition);
    walk.branches.push({
      conditions: [...conditions, condition],
      target: stateTarget(walk.checker, state.whenTrue),
    });
    walk.branches.push({
      conditions: [...conditions, negate(condition)],
      target: stateTarget(walk.checker, state.whenFalse),
    });
    return;
  }
  walk.branches.push({ conditions, target: stateTarget(walk.checker, state) });
}

/** Walk statements; returns true when every path through them returns. */
function walkStatements(
  statements: ReadonlyArray<ts.Statement>,
  at: { walk: Walk; conditions: string[] },
): boolean {
  let guards = at.conditions;
  for (const statement of statements) {
    if (walkStatement(statement, { walk: at.walk, conditions: guards }) === "returns") return true;
    if (ts.isIfStatement(statement) && statement.elseStatement === undefined) {
      const thenReturns = alwaysReturns(statement.thenStatement);
      if (thenReturns) guards = [...guards, negate(text(statement.expression))];
    }
  }
  return false;
}

function alwaysReturns(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.some(alwaysReturns);
  if (ts.isIfStatement(statement)) {
    return (
      statement.elseStatement !== undefined &&
      alwaysReturns(statement.thenStatement) &&
      alwaysReturns(statement.elseStatement)
    );
  }
  return false;
}

function walkStatement(
  statement: ts.Statement,
  at: { walk: Walk; conditions: string[] },
): "returns" | "continues" {
  const { walk, conditions } = at;
  if (ts.isReturnStatement(statement)) {
    walk.returnsSeen += 1;
    branchesOf(statement.expression, at);
    return "returns";
  }
  if (ts.isBlock(statement))
    return walkStatements(statement.statements, at) ? "returns" : "continues";
  if (!ts.isIfStatement(statement)) return "continues";
  walk.conditions.push(statement.expression);
  const condition = text(statement.expression);
  walkStatement(statement.thenStatement, { walk, conditions: [...conditions, condition] });
  if (statement.elseStatement) {
    walkStatement(statement.elseStatement, {
      walk,
      conditions: [...conditions, negate(condition)],
    });
  }
  return alwaysReturns(statement) ? "returns" : "continues";
}

function countReturns(body: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== body) return;
    if (ts.isReturnStatement(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return count;
}

function bindingName(node: ts.BindingName | undefined): string | null {
  return node !== undefined && ts.isIdentifier(node) ? node.text : null;
}

function contextBinding(parameter: ts.ParameterDeclaration | undefined): string | null {
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return null;
  for (const element of parameter.name.elements) {
    const key = element.propertyName ?? element.name;
    if (ts.isIdentifier(key) && key.text === "context") return bindingName(element.name);
  }
  return null;
}

/** Record locals bound to the payload (`const { a } = event.payload`) or to `context.get()`. */
function collectAliases(body: ts.Node, scope: HandlerScope): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && isContextGet(node.initializer, scope)) {
        scope.contextAliases.add(node.name.text);
      }
      const source = classify(node.initializer, scope);
      if (source?.source === "payload") bindPayload(node.name, { scope, path: source.path });
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

function bindPayload(name: ts.BindingName, at: { scope: HandlerScope; path: string }): void {
  if (ts.isIdentifier(name)) {
    at.scope.payloadAliases.set(name.text, at.path);
    return;
  }
  if (!ts.isObjectBindingPattern(name)) return;
  for (const element of name.elements) {
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key)) continue;
    bindPayload(element.name, {
      scope: at.scope,
      path: [at.path, key.text].filter(Boolean).join("."),
    });
  }
}

function conditionLiterals(conditions: ReadonlyArray<ts.Expression>): Array<number | string> {
  const literals = new Set<number | string>();
  const visit = (node: ts.Node): void => {
    if (ts.isExpression(node)) {
      const value = literalValue(node);
      if (typeof value === "number" || typeof value === "string") literals.add(value);
    }
    ts.forEachChild(node, visit);
  };
  for (const condition of conditions) visit(condition);
  return [...literals].sort((left, right) => String(left).localeCompare(String(right)));
}

function analyzeFunction(
  fn: HandlerFunction,
  at: { registration: Registration; checker: ts.TypeChecker; root: string },
): AtlasExplanation {
  const scope: HandlerScope = {
    eventName: bindingName(fn.parameters[0]?.name),
    contextName: contextBinding(fn.parameters[1]),
    payloadAliases: new Map(),
    contextAliases: new Set(),
  };
  const location = locationOf(at.registration.call, at.root);
  const walk: Walk = { checker: at.checker, branches: [], returnsSeen: 0, conditions: [] };
  collectAliases(fn.body, scope);
  if (ts.isBlock(fn.body)) {
    walkStatements(fn.body.statements, { walk, conditions: [] });
    if (walk.returnsSeen !== countReturns(fn.body)) {
      const reason = "unsupported control flow (switch, loop or try around a return)";
      return { status: "not_analyzed", location, reason, snippet: snippet(fn) };
    }
    if (!alwaysReturns(fn.body)) walk.branches.push({ conditions: [], target: { kind: "stay" } });
  } else {
    branchesOf(fn.body, { walk, conditions: [] });
  }
  const reads = collectReads(fn.body, scope);
  const sorted = (values: Set<string>) => [...values].sort();
  return {
    status: "analyzed",
    location,
    registration: at.registration.kind,
    branches: walk.branches,
    payloadReads: sorted(reads.payloadReads),
    contextReads: sorted(reads.contextReads),
    contextWrites: sorted(reads.contextWrites),
    readsActorState: reads.readsActorState,
    comparisons: reads.comparisons,
    literals: conditionLiterals(walk.conditions),
  };
}

/** Explain one registration's handler. Anything not understood is `not_analyzed`, never guessed. */
export function explainRegistration(
  registration: Registration,
  context: { checker: ts.TypeChecker; root: string },
): AtlasExplanation {
  const handler = registration.handler;
  const location = locationOf(registration.call, context.root);
  if (handler === undefined) {
    return {
      status: "not_analyzed",
      location,
      reason: "handler is not a plain property",
      snippet: snippet(registration.call),
    };
  }
  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    return analyzeFunction(handler, { registration, ...context });
  }
  return {
    status: "not_analyzed",
    location,
    reason: `handler \`${text(handler)}\` is a reference, not an inline function`,
    snippet: snippet(handler),
  };
}
