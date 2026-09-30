import type { AuthConfig, Collection, Environment, FormField, HttpMethod, KeyValue, RequestBody, SatchelRequest, TreeNode, Workspace } from "@/types";
import {
  COLLECTION_FILE,
  COLLECTIONS_DIR,
  ENVIRONMENTS_DIR,
  FOLDER_FILE,
  FORMAT_ID,
  FORMAT_VERSION,
  LOCAL_FILE,
  LOCAL_GITIGNORE,
  REQUEST_SUFFIX,
  ROOT_FILE,
  toJson,
  type FileMap,
} from "./layout";
import { emptyLocalState, type LocalState } from "./local";
import { nameAllocator, slugify } from "./slug";

// Every object below is built key by key, in a fixed order, so the JSON (and
// its git diff) doesn't depend on how the in-memory object happened to be built.

const pair = (kv: KeyValue) => ({ key: kv.key, value: kv.value, enabled: kv.enabled });

/** A variable list; secret values go to `secretsOut` and are written as "" in the shared file. */
function variables(list: readonly KeyValue[], secretsOut: Record<string, string>) {
  return list.map((v) => {
    if (!v.secret) return pair(v);
    if (v.value !== "") secretsOut[v.key] = v.value;
    return { key: v.key, value: "", enabled: v.enabled, secret: true };
  });
}

function auth(a: AuthConfig) {
  switch (a.type) {
    case "none":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: a.token };
    case "basic":
      return { type: "basic", username: a.username, password: a.password };
    case "apikey":
      return { type: "apikey", key: a.key, value: a.value, in: a.in };
  }
}

/** `root`: the workspace folder, to store form-data files inside it as portable relative paths. */
function formField(f: FormField, index: number, root: string | null, filesOut: Record<string, string>) {
  const base = { key: f.key, type: f.type, value: f.value, enabled: f.enabled };
  if (f.type !== "file") return base;
  const out: Record<string, unknown> = { ...base };
  if (f.fileName !== undefined) out.fileName = f.fileName;
  if (f.filePath) {
    const rel = root ? relativeInside(root, f.filePath) : null;
    if (rel !== null) out.path = rel;
    else filesOut[String(index)] = f.filePath; // an absolute path only means something on this machine
  }
  return out;
}

function body(b: RequestBody, root: string | null, filesOut: Record<string, string>) {
  switch (b.mode) {
    case "none":
      return { mode: "none" };
    case "raw":
      return { mode: "raw", language: b.language, raw: b.raw };
    case "urlencoded":
      return { mode: "urlencoded", params: b.params.map(pair) };
    case "formdata":
      return { mode: "formdata", fields: b.fields.map((f, i) => formField(f, i, root, filesOut)) };
  }
}

export function requestFile(r: SatchelRequest, root: string | null, local: LocalState): string {
  const files: Record<string, string> = {};
  const out: Record<string, unknown> = { id: r.id, name: r.name, method: r.method, url: r.url, params: r.params.map(pair) };
  if (r.pathVariables && Object.keys(r.pathVariables).length) out.pathVariables = { ...r.pathVariables };
  out.headers = r.headers.map(pair);
  out.auth = auth(r.auth);
  out.body = body(r.body, root, files);
  if (Object.keys(files).length) local.files[r.id] = files;
  return toJson(out);
}

function writeItems(items: readonly TreeNode[], dir: string, trail: string[], w: Writer): string[] {
  const alloc = nameAllocator([COLLECTION_FILE, FOLDER_FILE]);
  const order: string[] = [];
  for (const node of items) {
    if (node.type === "folder") {
      const name = alloc(slugify(node.name));
      const childOrder = writeItems(node.children, `${dir}/${name}`, [...trail, node.name], w);
      const path = `${dir}/${name}/${FOLDER_FILE}`;
      w.files?.set(path, toJson({ id: node.id, name: node.name, order: childOrder }));
      w.labels.set(path, { kind: "folder", id: node.id, trail: [...trail, node.name] });
      order.push(name);
    } else {
      const name = alloc(slugify(node.request.name), REQUEST_SUFFIX);
      const path = `${dir}/${name}`;
      w.files?.set(path, requestFile(node.request, w.root, w.local));
      w.labels.set(path, { kind: "request", id: node.id, trail: [...trail, node.request.name], method: node.request.method });
      order.push(name);
    }
  }
  return order;
}

function writeCollection(c: Collection, dir: string, w: Writer) {
  const order = writeItems(c.items, dir, [c.name], w);
  if (w.files) {
    const secrets: Record<string, string> = {};
    const vars = variables(c.variables, secrets);
    if (Object.keys(secrets).length) w.local.secrets.collections[c.id] = secrets;
    w.files.set(`${dir}/${COLLECTION_FILE}`, toJson({ id: c.id, name: c.name, variables: vars, order }));
  }
  w.labels.set(`${dir}/${COLLECTION_FILE}`, { kind: "collection", id: c.id, trail: [c.name] });
}

function environmentFile(e: Environment, local: LocalState): string {
  const secrets: Record<string, string> = {};
  const out: Record<string, unknown> = { id: e.id, name: e.name };
  if (e.color) out.color = e.color;
  out.variables = variables(e.variables, secrets);
  if (Object.keys(secrets).length) local.secrets.environments[e.id] = secrets;
  return toJson(out);
}

/** What a workspace file holds, in the app's own terms (for a git changes list). */
export type FileLabel =
  | { kind: "request"; id: string; trail: string[]; method: HttpMethod }
  | { kind: "folder" | "collection" | "environment"; id: string; trail: string[] }
  | { kind: "workspace"; trail: string[] };

interface Writer {
  /** null when only the labels are wanted: paths are allocated the same way, no file is built */
  files: FileMap | null;
  labels: Map<string, FileLabel>;
  root: string | null;
  local: LocalState;
}

function write(ws: Workspace, root: string | null, contents = true): Writer {
  const w: Writer = { files: contents ? new Map() : null, labels: new Map(), root, local: emptyLocalState() };
  const { files, local } = w;
  local.activeEnvironmentId = ws.activeEnvironmentId;

  const colAlloc = nameAllocator();
  const collectionOrder = ws.collections.map((c) => {
    const dir = colAlloc(slugify(c.name));
    writeCollection(c, `${COLLECTIONS_DIR}/${dir}`, w);
    return dir;
  });

  const envAlloc = nameAllocator();
  const environmentOrder = ws.environments.map((e) => {
    const name = envAlloc(slugify(e.name), ".json");
    files?.set(`${ENVIRONMENTS_DIR}/${name}`, environmentFile(e, local));
    w.labels.set(`${ENVIRONMENTS_DIR}/${name}`, { kind: "environment", id: e.id, trail: [e.name] });
    return name;
  });

  w.labels.set(ROOT_FILE, { kind: "workspace", trail: ["Workspace settings"] });
  if (!files) return w;

  const globalSecrets: Record<string, string> = {};
  const globals = variables(ws.globals, globalSecrets);
  local.secrets.globals = globalSecrets;

  files.set(
    ROOT_FILE,
    toJson({ format: FORMAT_ID, version: FORMAT_VERSION, collections: collectionOrder, environments: environmentOrder, globals }),
  );
  files.set(LOCAL_FILE, toJson(local));
  files.set(LOCAL_GITIGNORE, "# Personal Satchel state (active environment, secrets). Never commit it.\n*\n");
  return w;
}

/**
 * The whole workspace as files. `root` (the folder's absolute path) lets
 * form-data files inside the workspace be stored as relative paths.
 */
export function workspaceToFiles(ws: Workspace, root: string | null = null): FileMap {
  return write(ws, root).files!;
}

/**
 * Which request, folder, collection or environment each workspace file holds.
 * Only the paths: no file is built, so it's cheap enough to run as the workspace changes.
 */
export function workspaceFileLabels(ws: Workspace): Map<string, FileLabel> {
  return write(ws, null, false).labels;
}

/** `path` relative to `root` with "/" separators, or null when it isn't inside it. */
export function relativeInside(root: string, path: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const p = norm(path);
  const rel = p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null;
  return rel && !rel.split("/").includes("..") ? rel : null;
}
