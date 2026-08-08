const TRY_CATCH_MESSAGE =
  "try/catch is banned in library code — handle failures explicitly with Either/Result instead. try/finally for resource cleanup is fine.";

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
  },
};
