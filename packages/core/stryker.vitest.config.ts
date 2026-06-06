import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    exclude: ["tests/showcase/**"],
  },
});
