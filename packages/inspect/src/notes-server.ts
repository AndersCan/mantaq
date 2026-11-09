/**
 * Request logic of the dev server's notes endpoint, without Vite or the
 * filesystem: the glue passes in the request and the files, so it is
 * unit-tested with in-memory files.
 */
import { Either } from "@mantaq/utils";
import {
  MAX_NOTE_LENGTH,
  NOTES_VERSION,
  appendNote,
  cleanNoteText,
  isNoteTarget,
  notesFileOf,
  parseNotes,
  targetProblem,
} from "./notes.ts";
import type { MachineShape, Note, NoteAdded, NoteTarget, NotesList } from "./notes.ts";
import { posix, relative, sep } from "node:path";

export const MAX_BODY_BYTES = 16384;

export interface NotesRequest {
  method: string;
  query: URLSearchParams;
  headers: { host?: string; origin?: string; contentType?: string; secFetchSite?: string };
  remote: string | undefined;
  /** `""` for GET. The glue enforces the byte limit before calling. */
  body: string;
}

export interface NotesContext {
  /** Vite root, for the path shown to the person. */
  root: string;
  /** Right = the machine file and shape; Left = the id is unknown, or the machines failed to load. */
  owner: (
    machine: string,
  ) => Promise<Either<"unknown" | "load", { file: string; machine: MachineShape }>>;
  files: {
    read: (path: string) => string | undefined;
    write: (path: string, text: string) => Either<string, void>;
  };
}

export interface NotesResponse {
  status: number;
  body: NotesList | NoteAdded | { error: string };
}

function fail(status: number, error: string): NotesResponse {
  return { status, body: { error } };
}

function isLoopback(address: string | undefined): boolean {
  return (
    address !== undefined &&
    (address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127."))
  );
}

function isSameOrigin(headers: NotesRequest["headers"]): boolean {
  if (headers.secFetchSite !== undefined && headers.secFetchSite !== "same-origin") return false;
  if (headers.origin === undefined) return true;
  try {
    return new URL(headers.origin).host === headers.host;
  } catch {
    return false;
  }
}

function parseBody(body: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function shown(root: string, file: string): string {
  return relative(root, file).split(sep).join(posix.sep);
}

function guard(request: NotesRequest): NotesResponse | undefined {
  if (!isLoopback(request.remote)) {
    return fail(403, "notes can only be read and saved from this computer");
  }
  if (!isSameOrigin(request.headers)) {
    return fail(403, "notes can only be read and saved from the live page");
  }
  if (request.method === "GET") {
    return (request.query.get("machine") ?? "") === ""
      ? fail(400, "name a machine: ?machine=<id>")
      : undefined;
  }
  if (request.method !== "POST") return fail(405, "use GET or POST");
  if (!(request.headers.contentType ?? "").toLowerCase().startsWith("application/json")) {
    return fail(415, "send the note as JSON");
  }
  if (new TextEncoder().encode(request.body).length > MAX_BODY_BYTES) {
    return fail(413, `the note is longer than ${MAX_NOTE_LENGTH} characters`);
  }
  return undefined;
}

interface Post {
  machine: string;
  target: NoteTarget;
  text: string;
}

/** The body checks that need no machine; the machine check sits between them and the target. */
function parsePost(body: string): Either<NotesResponse, Record<string, unknown>> {
  const parsed = parseBody(body);
  if (parsed === undefined) return Either.left(fail(400, "the request was not valid JSON"));
  if (parsed["version"] !== NOTES_VERSION) {
    return Either.left(fail(400, "this page is out of date; reload it"));
  }
  return Either.right(parsed);
}

function checkPost(
  body: Record<string, unknown>,
  machine: string,
  shape: MachineShape,
): Either<NotesResponse, Post> {
  const target = body["target"];
  if (!isNoteTarget(target)) return Either.left(fail(400, "the note needs a state or an arrow"));
  const problem = targetProblem(shape, { machine, target });
  if (problem !== undefined) return Either.left(fail(404, problem));
  const text = typeof body["note"] === "string" ? cleanNoteText(body["note"]) : "";
  if (text === "") return Either.left(fail(400, "the note is empty"));
  if (text.length > MAX_NOTE_LENGTH) {
    return Either.left(fail(400, `the note is longer than ${MAX_NOTE_LENGTH} characters`));
  }
  return Either.right({ machine, target, text });
}

function save(context: NotesContext, where: Where, post: Post): NotesResponse {
  const added = appendNote(where.existing, {
    file: where.machineFile,
    machine: post.machine,
    target: post.target,
    note: post.text,
  });
  const written = context.files.write(where.path, added.text);
  if (Either.isLeft(written)) return fail(500, `could not write ${where.file} (${written[0]})`);
  return { status: 200, body: { version: NOTES_VERSION, file: where.file, note: added.note } };
}

interface Where {
  machineFile: string;
  path: string;
  file: string;
  existing: string | undefined;
}

function list(where: Where, machine: string): NotesResponse {
  const parsed =
    where.existing === undefined
      ? Either.right<Note[]>([])
      : parseNotes(where.existing, where.file);
  if (Either.isLeft(parsed)) return fail(409, parsed[0]);
  return {
    status: 200,
    body: {
      version: NOTES_VERSION,
      file: where.file,
      exists: where.existing !== undefined,
      notes: parsed[1].filter((note) => note.machine === undefined || note.machine === machine),
    },
  };
}

function ownerFailure(reason: "unknown" | "load", machine: string): NotesResponse {
  return reason === "unknown"
    ? fail(404, `no machine ${machine} on this dev server`)
    : fail(500, "the machines did not load; see the dev server output");
}

function refusedVersion(where: Where): NotesResponse | undefined {
  if (where.existing === undefined) return undefined;
  const parsed = parseNotes(where.existing, where.file);
  return Either.isLeft(parsed) ? fail(409, parsed[0]) : undefined;
}

export async function answerNotes(
  request: NotesRequest,
  context: NotesContext,
): Promise<NotesResponse> {
  const refused = guard(request);
  if (refused !== undefined) return refused;
  const get = request.method === "GET";
  const body: Either<NotesResponse, Record<string, unknown>> = get
    ? Either.right({})
    : parsePost(request.body);
  if (Either.isLeft(body)) return body[0];
  const machine = get ? (request.query.get("machine") ?? "") : String(body[1]["machine"]);
  const owner = await context.owner(machine);
  if (Either.isLeft(owner)) return ownerFailure(owner[0], machine);
  const path = notesFileOf(owner[1].file);
  const where = {
    machineFile: owner[1].file,
    path,
    file: shown(context.root, path),
    existing: context.files.read(path),
  };
  if (get) return list(where, machine);
  const post = checkPost(body[1], machine, owner[1].machine);
  if (Either.isLeft(post)) return post[0];
  return refusedVersion(where) ?? save(context, where, post[1]);
}
