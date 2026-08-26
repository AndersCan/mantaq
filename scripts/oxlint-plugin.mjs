const TRY_CATCH_MESSAGE =
  "try/catch is banned in library code — handle failures explicitly with Either/Result instead. try/finally for resource cleanup is fine.";

const THROW_MESSAGE =
  "throw is banned in library code — errors flow as values (Either/Result), not exceptions. Assertion APIs (packages/testkit/src) are exempt. Programmer-error validation sites are exempted per-file in vite.config.ts.";

const NO_CONSOLE_MESSAGE =
  "console.log/warn/error/info/debug is banned in library src — failures must throw (programmer error) or take the machine to the error state. Errors flow as values, never as log lines.";

export default {
  rules: {
    "no-try-catch": {
      meta: {
        type: "problem",
        docs: {
          description: "Ban try/catch in library code — prefer Either/Result.",
        },
        messages: {
          tryCatch: TRY_CATCH_MESSAGE,
        },
      },
      create(context) {
        return {
          TryStatement(node) {
            if (node.handler) {
              context.report({ node, messageId: "tryCatch" });
            }
          },
        };
      },
    },
    "no-throw": {
      meta: {
        type: "problem",
        docs: {
          description: "Ban throw in library code — prefer Either/Result.",
        },
        messages: {
          throwStatement: THROW_MESSAGE,
        },
      },
      create(context) {
        return {
          ThrowStatement(node) {
            context.report({ node, messageId: "throwStatement" });
          },
        };
      },
    },
    "no-console": {
      meta: {
        type: "problem",
        docs: {
          description: "Ban console.* in library src — failures throw or hit the error state.",
        },
        messages: {
          consoleMethod: NO_CONSOLE_MESSAGE,
        },
      },
      create(context) {
        return {
          MemberExpression(node) {
            if (
              node.object.type === "Identifier" &&
              node.object.name === "console" &&
              node.property.type === "Identifier"
            ) {
              context.report({ node, messageId: "consoleMethod" });
            }
          },
        };
      },
    },
  },
};
