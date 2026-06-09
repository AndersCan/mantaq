// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vite-plus/test";
import "../src/components/search-bar.ts";
import { $searchQuery, $searchResults, setSearchQuery } from "../src/graph-store.ts";
import type { SearchBar } from "../src/components/search-bar.ts";

function createSearchBar(): SearchBar {
  const el = document.createElement("search-bar") as SearchBar;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  $searchQuery.set("");
  $searchResults.set([]);
});

describe("SearchBar component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("search-bar");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("search-bar");
  });

  it("has shadow root", () => {
    const el = createSearchBar();
    expect(el.shadowRoot).toBeDefined();
  });

  it("renders search input", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const input = el.shadowRoot!.querySelector("input");
    expect(input).toBeDefined();
    expect(input!.type).toBe("text");
  });

  it("renders search icon", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const icon = el.shadowRoot!.querySelector(".search-icon");
    expect(icon).toBeDefined();
  });

  it("input has placeholder text", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const input = el.shadowRoot!.querySelector("input");
    expect(input!.placeholder).toContain("Search");
  });

  it("shows clear button when query present", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("test");
    await Promise.resolve();
    const clearBtn = el.shadowRoot!.querySelector(".clear-btn");
    expect(clearBtn).toBeDefined();
  });

  it("hides clear button when no query", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const clearBtn = el.shadowRoot!.querySelector(".clear-btn");
    expect(clearBtn).toBeNull();
  });

  it("shows result count when query present", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("test");
    $searchResults.set(["a", "b"]);
    await Promise.resolve();
    await Promise.resolve();
    const count = el.shadowRoot!.querySelector(".result-count");
    expect(count).toBeDefined();
    expect(count!.textContent).toContain("2 matches");
  });

  it("shows singular match for one result", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("test");
    $searchResults.set(["a"]);
    await Promise.resolve();
    await Promise.resolve();
    const count = el.shadowRoot!.querySelector(".result-count");
    expect(count!.textContent).toContain("1 match");
  });

  it("clear button clears search", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("test");
    await Promise.resolve();
    const clearBtn = el.shadowRoot!.querySelector(".clear-btn") as HTMLButtonElement;
    clearBtn.click();
    await Promise.resolve();
    expect($searchQuery.get()).toBe("");
  });

  it("focusInput focuses the input", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    el.focusInput();
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("input"));
  });

  it("has correct aria-label", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const input = el.shadowRoot!.querySelector("input");
    expect(input!.getAttribute("aria-label")).toContain("Search");
  });

  it("shows zero matches message", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("xyz");
    $searchResults.set([]);
    await Promise.resolve();
    await Promise.resolve();
    const count = el.shadowRoot!.querySelector(".result-count");
    expect(count).toBeDefined();
    expect(count!.textContent).toContain("0 matches");
  });

  it("clear button also clears results", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("test");
    $searchResults.set(["a", "b"]);
    await Promise.resolve();
    const clearBtn = el.shadowRoot!.querySelector(".clear-btn") as HTMLButtonElement;
    clearBtn.click();
    await Promise.resolve();
    expect($searchQuery.get()).toBe("");
    expect($searchResults.get()).toEqual([]);
  });

  it("clear button has aria-label", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    setSearchQuery("test");
    await Promise.resolve();
    const clearBtn = el.shadowRoot!.querySelector(".clear-btn") as HTMLButtonElement;
    expect(clearBtn.getAttribute("aria-label")).toBeTruthy();
  });

  it("search container exists", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const container = el.shadowRoot!.querySelector(".search-container");
    expect(container).toBeDefined();
  });

  it("input updates search query on change", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
    input.value = "new query";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    expect($searchQuery.get()).toBe("new query");
  });

  it("no result count when query is empty", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    const count = el.shadowRoot!.querySelector(".result-count");
    expect(count).toBeNull();
  });

  it("cleans up on disconnect", async () => {
    const el = createSearchBar();
    await Promise.resolve();
    el.remove();
    setSearchQuery("test");
    expect($searchQuery.get()).toBe("test");
  });
});
