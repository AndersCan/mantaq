// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import { mantaqViz } from "@mantaq/inspect/astro";
import remarkGfm from "remark-gfm";

// https://astro.build/config
export default defineConfig({
  site: "https://anderscan.github.io",
  base: "/mantaq",
  devToolbar: {
    enabled: false,
  },
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  vite: {},
  integrations: [
    mantaqViz({
      machines: [
        "src/content/docs/checkout.ts",
        "src/content/docs/saga.ts",
        "src/content/docs/login.ts",
        "src/content/docs/checkout-with-bugs.ts",
        "src/content/docs/photo-upload.ts",
        "src/content/docs/photo-queue.ts",
      ],
      // Seeded, so every build draws the same coverage. 2000 runs miss the saga's
      // five-step path to `completed` on this seed; 5000 take ~0.3s.
      fuzz: { seed: 1, iterations: 5000 },
    }),
    starlight({
      title: "Mantaq",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        alt: "Mantaq",
        replacesTitle: true,
      },
      customCss: ["./src/styles/machine.css"],
      plugins: [
        starlightLlmsTxt({
          projectName: "Mantaq",
        }),
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/anderscan/mantaq" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Start with your agent", slug: "getting-started/with-an-agent" },
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "State Machines & Statecharts", slug: "getting-started/state-machines" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Your first machine", slug: "getting-started/first-machine" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Actors", slug: "core-concepts/actors" },
            { label: "States", slug: "core-concepts/states" },
            { label: "Events", slug: "core-concepts/events" },
            { label: "Diagrams", slug: "core-concepts/diagrams" },
            { label: "Effects", slug: "core-concepts/effects" },
            { label: "Context", slug: "core-concepts/context" },
            { label: "Error Handling", slug: "core-concepts/error-handling" },
            { label: "Testing", slug: "guides/actor-testing" },
            { label: "Test Harness", slug: "guides/testing-guide" },
            { label: "Machines in an app", slug: "guides/machines-in-an-app" },
            { label: "Visualizer", slug: "guides/visualizer" },
            { label: "Design gate", slug: "guides/design-gate" },
          ],
        },
        {
          label: "Sugar",
          items: [
            { label: "Overview", slug: "sugar" },
            { label: "Batch Creation", slug: "sugar/batch-creation" },
            { label: "Matching", slug: "sugar/matching" },
            { label: "Dynamic Children", slug: "sugar/dynamic-children" },
            { label: "Effect Helpers", slug: "sugar/effect-helpers" },
            { label: "Composition", slug: "sugar/composition" },
            { label: "Request / Response", slug: "sugar/request-response" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "@mantaq/core", slug: "reference/core" },
            { label: "@mantaq/sugar", slug: "reference/sugar" },
            { label: "@mantaq/test", slug: "reference/test" },
            { label: "@mantaq/traversal", slug: "reference/traversal" },
          ],
        },
      ],
    }),
  ],
});
