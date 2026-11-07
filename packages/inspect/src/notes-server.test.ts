import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";
import { answerNotes } from "./notes-server.ts";
import type { NotesContext, NotesRequest } from "./notes-server.ts";

function setup(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const writes: string[] = [];
  const context: NotesContext = {
    root: "/proj",
    owner: async (machine) => {
      if (machine === "boom") return Either.left("load" as const);
      return machine === "m" ? Either.right("/proj/src/m.ts") : Either.left("unknown" as const);
    },
    files: {
      read: (path) => store.get(path),
      write: (path, text) => {
        if (path.includes("denied")) return Either.left("EACCES");
        writes.push(path);
        store.set(path, text);
        return Either.right();
      },
    },
  };
  return { store, writes, context };
}

function get(query: string, extra: Partial<NotesRequest> = {}): NotesRequest {
  return {
    method: "GET",
    query: new URLSearchParams(query),
    headers: { host: "localhost:5173" },
    remote: "127.0.0.1",
    body: "",
    ...extra,
  };
}

function post(body: unknown, extra: Partial<NotesRequest> = {}): NotesRequest {
  return get("", {
    method: "POST",
    headers: { host: "localhost:5173", contentType: "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...extra,
  });
}

const valid = { version: 1, machine: "m", target: { kind: "state", state: "s" }, note: "hi" };

describe("answerNotes errors", () => {
  const table: Array<[string, (c: NotesContext) => Promise<unknown>, number, string]> = [];
  const add = (
    name: string,
    request: NotesRequest,
    status: number,
    error: string,
    files?: Record<string, string>,
  ) =>
    table.push([
      name,
      async () => {
        const { context } = setup(files);
        return answerNotes(request, context);
      },
      status,
      error,
    ]);
  add(
    "remote",
    get("machine=m", { remote: "10.0.0.2" }),
    403,
    "notes can only be read and saved from this computer",
  );
  add(
    "no remote",
    get("machine=m", { remote: undefined }),
    403,
    "notes can only be read and saved from this computer",
  );
  add(
    "origin",
    get("machine=m", { headers: { host: "a", origin: "http://evil" } }),
    403,
    "notes can only be read and saved from the live page",
  );
  add(
    "bad origin",
    get("machine=m", { headers: { host: "a", origin: "nonsense" } }),
    403,
    "notes can only be read and saved from the live page",
  );
  add(
    "fetch site",
    get("machine=m", { headers: { secFetchSite: "cross-site" } }),
    403,
    "notes can only be read and saved from the live page",
  );
  add("method", get("", { method: "DELETE" }), 405, "use GET or POST");
  add("no machine", get(""), 400, "name a machine: ?machine=<id>");
  add(
    "content type",
    post(valid, { headers: { contentType: "text/plain" } }),
    415,
    "send the note as JSON",
  );
  add("too big", post("x".repeat(16385)), 413, "the note is longer than 2000 characters");
  add("not json", post("{"), 400, "the request was not valid JSON");
  add("array", post("[]"), 400, "the request was not valid JSON");
  add("version", post({ ...valid, version: 2 }), 400, "this page is out of date; reload it");
  add(
    "unknown machine",
    post({ ...valid, machine: "zz" }),
    404,
    "no machine zz on this dev server",
  );
  add("get unknown machine", get("machine=zz"), 404, "no machine zz on this dev server");
  add(
    "load fail",
    get("machine=boom"),
    500,
    "the machines did not load; see the dev server output",
  );
  add(
    "target",
    post({ ...valid, target: { kind: "state", state: "a b" } }),
    400,
    "the note needs a state",
  );
  add("empty", post({ ...valid, note: " \n " }), 400, "the note is empty");
  add("not text", post({ ...valid, note: 5 }), 400, "the note is empty");
  add(
    "long",
    post({ ...valid, note: "a".repeat(2001) }),
    400,
    "the note is longer than 2000 characters",
  );
  add(
    "v2 file post",
    post(valid),
    409,
    "src/m.notes.md is mantaq notes v2; update @mantaq/inspect",
    {
      "/proj/src/m.notes.md": "mantaq notes v2\n",
    },
  );
  add(
    "v2 file get",
    get("machine=m"),
    409,
    "src/m.notes.md is mantaq notes v2; update @mantaq/inspect",
    {
      "/proj/src/m.notes.md": "mantaq notes v2\n",
    },
  );
  test.each(table)("%s", async (_name, run, status, error) => {
    expect(await run(undefined as never)).toEqual({ status, body: { error } });
  });

  test("a failed write names the file and the reason", async () => {
    const { context } = setup();
    const answer = await answerNotes(post(valid), {
      ...context,
      owner: async () => Either.right("/proj/denied.ts"),
    });
    expect(answer).toEqual({
      status: 500,
      body: { error: "could not write denied.notes.md (EACCES)" },
    });
  });

  test("a v2 file is not written", async () => {
    const { context, writes } = setup({ "/proj/src/m.notes.md": "mantaq notes v2\n" });
    await answerNotes(post(valid), context);
    expect(writes).toEqual([]);
  });
});

describe("answerNotes", () => {
  test("GET with no file", async () => {
    const { context } = setup();
    expect(await answerNotes(get("machine=m"), context)).toEqual({
      status: 200,
      body: { version: 1, file: "src/m.notes.md", exists: false, notes: [] },
    });
  });

  test("GET filters by machine and keeps notes without a machine", async () => {
    const { context } = setup({
      "/proj/src/m.notes.md":
        "- id: n1\n  machine: m\n  note: a\n- id: n2\n  machine: other\n  note: b\n- id: n3\n  note: c\n",
    });
    const answer = await answerNotes(get("machine=m"), context);
    const body = answer.body as { exists: boolean; notes: Array<{ id: string }> };
    expect(body.exists).toBe(true);
    expect(body.notes.map((note) => note.id)).toEqual(["n1", "n3"]);
  });

  test("POST creates the file, then appends and keeps hand-added lines", async () => {
    const { context, store } = setup();
    const first = await answerNotes(post(valid), context);
    expect(first.status).toBe(200);
    expect((first.body as { note: { id: string } }).note.id).toBe("n1");
    expect(store.get("/proj/src/m.notes.md")).toContain("# Notes on m.ts\n");
    store.set("/proj/src/m.notes.md", `${store.get("/proj/src/m.notes.md")}\nmy own line\n`);
    const second = await answerNotes(post({ ...valid, note: "two" }), context);
    expect((second.body as { note: { id: string } }).note.id).toBe("n2");
    const text = store.get("/proj/src/m.notes.md") ?? "";
    expect(text).toContain("my own line\n- id: n2");
  });

  test("IPv4-mapped loopback and same-origin requests are allowed", async () => {
    const { context } = setup();
    const answer = await answerNotes(
      get("machine=m", {
        remote: "::ffff:127.0.0.1",
        headers: {
          host: "localhost:5173",
          origin: "http://localhost:5173",
          secFetchSite: "same-origin",
        },
      }),
      context,
    );
    expect(answer.status).toBe(200);
    expect((await answerNotes(get("machine=m", { remote: "::1" }), context)).status).toBe(200);
  });
});
