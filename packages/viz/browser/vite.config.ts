import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

/* Fixture gallery — a standalone Vite app rooted at browser/ so `vp build`
 * and `vp preview` resolve index.html here regardless of the caller cwd. */
export default defineConfig({
  root: "browser",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  preview: {
    host: "localhost",
  },
});
