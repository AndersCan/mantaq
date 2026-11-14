import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";

const aiBadge = { text: "🤖", variant: "note" } as const;

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: (context) =>
      docsSchema({ extend: z.object({ author: z.enum(["ai", "human"]).default("ai") }) })(
        context,
      ).transform((data) =>
        data.author === "ai" && data.sidebar.badge === undefined
          ? { ...data, sidebar: { ...data.sidebar, badge: aiBadge } }
          : data,
      ),
  }),
};
