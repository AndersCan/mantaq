// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkGfm from "remark-gfm";

// https://astro.build/config
export default defineConfig({
  site: "https://anderscan.github.io",
  base: "/mantaq",
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  vite: {},
  integrations: [
    starlight({
      title: "Mantaq",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/anderscan/mantaq" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Actors", slug: "core-concepts/actors" },
            { label: "States", slug: "core-concepts/states" },
            { label: "Events", slug: "core-concepts/events" },
            { label: "Effects", slug: "core-concepts/effects" },
            { label: "Context", slug: "core-concepts/context" },
            { label: "Testing", slug: "guides/actor-testing" },
            { label: "Viz", slug: "guides/viz" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "@mantaq/core", slug: "reference/core" },
            { label: "@mantaq/sugar", slug: "reference/sugar" },
            { label: "@mantaq/viz", slug: "reference/viz" },
          ],
        },
      ],
    }),
  ],
});
