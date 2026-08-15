/* Phase 0 stub page — one hardcoded render target so the Playwright smoke
 * spec has something to see. Replaced by the fixture gallery in Phase 1. */
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./global.css";

const root = document.getElementById("root");
if (!root) throw new Error("fixture harness: #root not found");

createRoot(root).render(
  <StrictMode>
    <main className="page">
      <h1>@mantaq/viz fixture gallery</h1>
      <div className="stub-card" data-testid="stub">
        phase 0 — fixtures land in phase 1
      </div>
    </main>
  </StrictMode>,
);
