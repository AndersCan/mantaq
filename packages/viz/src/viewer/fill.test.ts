import { describe, expect, test } from "vite-plus/test";
import type { VizField, VizJson } from "../schema.ts";
import { fillSources } from "./fill.ts";

function field(name: string, input: VizField["input"], choices: VizJson[] = []): VizField {
  return { name, type: "x", optional: false, doc: null, input, choices, sample: "sample" };
}

const live = (state: string, payload: VizJson, context: VizJson) => ({ state, payload, context });

describe("fillSources", () => {
  test("fills a text field from the state's payload", () => {
    const fields = [
      field("code", "text"),
      field("answer", "choice", ["accepted", "declined"]),
      field("folderId", "text"),
    ];
    const result = fillSources(
      fields,
      live(
        "waitingForAdminToAccept",
        { code: "aaa", owner: "bbb", album: "Spain 2026", ownerName: "Nils" },
        { error: "" },
      ),
    );
    expect(result).toEqual([
      { path: "waitingForAdminToAccept", values: [{ field: "code", value: "aaa" }] },
    ]);
  });

  test("offers each list item, skipping a null entry", () => {
    const fields = [
      field("folderId", "text"),
      field("requesterKey", "text"),
      field("approve", "choice", [true, false]),
      field("role", "choice", ["viewer", "editor"]),
    ];
    const result = fillSources(
      fields,
      live("idle", null, {
        requests: [
          { folderId: "f1", requesterKey: "k1" },
          { folderId: "f2", requesterKey: "k2" },
        ],
        pendingRespond: null,
      }),
    );
    expect(result.map((each) => each.path)).toEqual(["context.requests[0]", "context.requests[1]"]);
    expect(result[1]?.values).toEqual([
      { field: "folderId", value: "f2" },
      { field: "requesterKey", value: "k2" },
    ]);
  });

  test("fills only the fields that share a name", () => {
    const result = fillSources(
      [field("folderId", "text"), field("name", "text")],
      live("idle", null, { folders: [{ id: "a", name: "Trip", role: "owner" }] }),
    );
    expect(result).toEqual([
      { path: "context.folders[0]", values: [{ field: "name", value: "Trip" }] },
    ]);
  });

  test("empty text does not fit", () => {
    expect(
      fillSources(
        [field("folderId", "text"), field("code", "text")],
        live("idle", null, { folderId: "", validFor: "1d", offCode: "" }),
      ),
    ).toEqual([]);
  });

  test("a choice-only match gives no source", () => {
    expect(
      fillSources(
        [field("role", "choice", ["viewer"]), field("who", "text")],
        live("idle", null, { role: "viewer" }),
      ),
    ).toEqual([]);
  });

  test("a kept source also fills a matching choice", () => {
    const result = fillSources(
      [field("role", "choice", ["viewer"]), field("who", "text")],
      live("idle", null, { role: "viewer", who: "me" }),
    );
    expect(result[0]?.values).toEqual([
      { field: "role", value: "viewer" },
      { field: "who", value: "me" },
    ]);
  });

  test("numbers must be finite; json takes anything", () => {
    const fields = [field("n", "number"), field("j", "json")];
    expect(fillSources(fields, live("s", { n: "1" }, null))).toEqual([]);
    expect(fillSources(fields, live("s", { n: 2, j: null }, null))[0]?.values).toEqual([
      { field: "n", value: 2 },
      { field: "j", value: null },
    ]);
  });

  test("the source with more filled fields comes first; ties keep state before context", () => {
    const fields = [field("a", "text"), field("b", "text")];
    const result = fillSources(fields, live("s", { a: "1" }, { a: "2", b: "3" }));
    expect(result.map((each) => each.path)).toEqual(["context", "s"]);
    const tie = fillSources(fields, live("s", { a: "1" }, { a: "2" }));
    expect(tie.map((each) => each.path)).toEqual(["s", "context"]);
  });

  test("25 list items give 20 sources", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ a: `v${index}` }));
    expect(fillSources([field("a", "text")], live("s", null, { a: "root", items }))).toHaveLength(
      20,
    );
  });

  test("an inherited key does not fit", () => {
    const payload = Object.create({ code: "x" }) as VizJson;
    expect(fillSources([field("code", "text")], live("s", payload, null))).toEqual([]);
  });
});
