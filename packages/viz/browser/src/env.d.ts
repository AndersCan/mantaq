/// <reference types="vite/client" />

/**
 * Harness bridge — `window.__viz` lets Playwright drive the mounted fixture
 * actor from the page: send events, advance the virtual clock, read the
 * active path. Timeline (`getHistoryLen`) lands with Phase 4.
 */
interface VizBridge {
  send(name: string, payload?: unknown): void;
  advance(ms: number): void;
  getPath(): string[];
  getHistoryLen(): number;
}

interface Window {
  __viz?: VizBridge;
}
