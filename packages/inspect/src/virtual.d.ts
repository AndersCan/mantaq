declare module "virtual:mantaq/targets" {
  import type { LiveTargets } from "./live-page.ts";
  export const targets: LiveTargets;
}

declare module "virtual:mantaq/documents" {
  export const root: string;
  export const documents: Readonly<
    Record<
      string,
      {
        text: string;
        machines: string[];
        findings: { machine: string; message: string }[];
        fuzzed: boolean;
      }
    >
  >;
}

declare module "virtual:mantaq/astro-client" {}
