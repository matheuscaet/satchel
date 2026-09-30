import {
  HTTP_METHODS,
  type AuthConfig,
  type Collection,
  type Environment,
  type FolderNode,
  type FormField,
  type HttpMethod,
  type KeyValue,
  type RequestBody,
  type SatchelRequest,
  type TreeNode,
  type Workspace,
} from "@/types";
import { normalizeRequest } from "@/url";
import {
  basename,
  COLLECTION_FILE,
  COLLECTIONS_DIR,
  ENVIRONMENTS_DIR,
  FOLDER_FILE,
  FORMAT_ID,
  FORMAT_VERSION,
  LOCAL_FILE,
  REQUEST_SUFFIX,
  ROOT_FILE,
  type FileMap,
} from "./layout";
import { emptyLocalState, parseLocalState, type LocalState } from "./local";

export interface Problem {
  path: string;
  message: string;
  /** error: the file was skipped (and is protected from being overwritten). warning: loaded, with a fix-up. */
  severity: "error" | "warning";
}

export interface FolderLoad {
  workspace: Workspace;
  problems: Problem[];
  /**
   * Paths (files, or directories ending in "/") the app must neither overwrite
   * nor delete: they failed to load, so the in-memory workspace doesn't
   * contain them and saving would otherwise lose them.
   */
  protectedPaths: string[];
}

export class WorkspaceFolderError extends Error {}

class FileError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function parseJsonFile(text: string): unknown {
  if (/^(<{7}|>{7}|={7})( |$)/m.test(text)) throw new FileError("has unresolved merge conflict markers (<<<<<<< / >>>>>>>)");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new FileError(`isn't valid JSON (${err instanceof Error ? err.message : "parse error"})`);
  }
}

function keyValues(v: unknown, what: string): KeyValue[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new FileError(`"${what}" should be a list`);
  return v.map((item, i) => {
    if (!isRecord(item) || typeof item.key !== "string") throw new FileError(`"${what}" item ${i + 1} needs a "key"`);
    const kv: KeyValue = { key: item.key, value: str(item.value), enabled: item.enabled !== false };
    if (item.secret === true) kv.secret = true;
    return kv;
  });
}

function parseAuth(v: unknown): AuthConfig {
  if (!isRecord(v)) return { type: "none" };
  switch (v.type) {
    case "bearer":
      return { type: "bearer", token: str(v.token) };
    case "basic":
      return { type: "basic", username: str(v.username), password: str(v.password) };
    case "apikey":
      return { type: "apikey", key: str(v.key), value: str(v.value), in: v.in === "query" ? "query" : "header" };
    case "none":
    case undefined:
      return { type: "none" };
    default:
      throw new FileError(`unknown auth type "${String(v.type)}"`);
  }
}

function parseBody(v: unknown, root: string | null, files: Record<string, string>): RequestBody {
  if (!isRecord(v)) return { mode: "none" };
  switch (v.mode) {
    case "raw": {
      const language = v.language === "text" || v.language === "xml" || v.language === "html" ? v.language : "json";
      return { mode: "raw", language, raw: str(v.raw) };
    }
    case "urlencoded":
      return { mode: "urlencoded", params: keyValues(v.params, "body.params") };
    case "formdata": {
      if (!Array.isArray(v.fields)) throw new FileError(`"body.fields" should be a list`);
      const fields = v.fields.map((f, i): FormField => {
        if (!isRecord(f) || typeof f.key !== "string") throw new FileError(`form field ${i + 1} needs a "key"`);
        const field: FormField = { key: f.key, value: str(f.value), enabled: f.enabled !== false, type: f.type === "file" ? "file" : "text" };
        if (field.type === "file") {
          if (typeof f.fileName === "string") field.fileName = f.fileName;
          const rel = typeof f.path === "string" ? f.path : null;
          const abs = files[String(i)];
          if (rel && root) field.filePath = `${root.replace(/[\\/]+$/, "")}/${rel}`;
          else if (abs) field.filePath = abs;
          if (field.filePath && !field.fileName) field.fileName = basename(field.filePath);
        }
        return field;
      });
      return { mode: "formdata", fields };
    }
    case "none":
    case undefined:
      return { mode: "none" };
    default:
      throw new FileError(`unknown body mode "${String(v.mode)}"`);
  }
}

function parseRequest(json: unknown, id: string, root: string | null, local: LocalState): SatchelRequest {
  if (!isRecord(json)) throw new FileError("should be a JSON object");
  if (typeof json.url !== "string") throw new FileError(`needs a "url"`);
  const method = typeof json.method === "string" ? json.method.toUpperCase() : "GET";
  if (!HTTP_METHODS.includes(method as HttpMethod)) throw new FileError(`unknown method "${method}"`);
  const pathVariables = isRecord(json.pathVariables)
    ? Object.fromEntries(Object.entries(json.pathVariables).map(([k, v]) => [k, str(v)]))
    : undefined;
  return normalizeRequest({
    id,
    name: str(json.name, "Untitled request"),
    method: method as HttpMethod,
    url: json.url,
    params: keyValues(json.params, "params"),
    pathVariables,
    headers: keyValues(json.headers, "headers"),
    auth: parseAuth(json.auth),
    body: parseBody(json.body, root, local.files[id] ?? {}),
  });
}

/** Secret values from local.json merged back into a variable list. */
function withSecrets(list: KeyValue[], secrets: Record<string, string> | undefined): KeyValue[] {
  if (!secrets) return list;
  return list.map((v) => (v.secret && secrets[v.key] !== undefined ? { ...v, value: secrets[v.key] } : v));
}

/** Entries of a directory: sub-directories and files directly inside it. */
function listDir(paths: readonly string[], dir: string): { dirs: string[]; files: string[] } {
  const prefix = `${dir}/`;
  const dirs = new Set<string>();
  const files: string[] = [];
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) files.push(rest);
    else dirs.add(rest.slice(0, slash));
  }
  return { dirs: [...dirs], files };
}

/** `listed` first (as far as they exist), then anything else on disk in name order — tolerant of hand edits and merges. */
function ordered(listed: unknown, present: readonly string[]): string[] {
  const set = new Set(present);
  const first = Array.isArray(listed) ? listed.filter((n): n is string => typeof n === "string" && set.has(n)) : [];
  const seen = new Set(first);
  return [...new Set(first), ...present.filter((n) => !seen.has(n)).sort()];
}

/**
 * Read a workspace folder's managed files back into a Workspace. Problems in
 * individual files are collected rather than thrown; only a missing or
 * unusable satchel.json (not a workspace at all) throws.
 */
/**
 * `secrets`: the folder's secret values from the keychain; they win over any
 * still kept in local.json by an older version.
 */
export function filesToWorkspace(files: FileMap, root: string | null = null, secrets?: LocalState["secrets"]): FolderLoad {
  const problems: Problem[] = [];
  const protectedPaths: string[] = [];
  const fail = (path: string, err: unknown, protect: string = path) => {
    if (!(err instanceof FileError)) throw err;
    problems.push({ path, message: err.message, severity: "error" });
    protectedPaths.push(protect);
  };

  const rootText = files.get(ROOT_FILE);
  if (rootText === undefined) throw new WorkspaceFolderError(`This folder isn't a Satchel workspace (no ${ROOT_FILE}).`);
  let rootJson: unknown;
  try {
    rootJson = parseJsonFile(rootText);
  } catch (err) {
    if (err instanceof FileError) throw new WorkspaceFolderError(`${ROOT_FILE} ${err.message}.`);
    throw err;
  }
  if (!isRecord(rootJson) || rootJson.format !== FORMAT_ID) throw new WorkspaceFolderError(`${ROOT_FILE} isn't a Satchel workspace file.`);
  if (typeof rootJson.version === "number" && rootJson.version > FORMAT_VERSION) {
    throw new WorkspaceFolderError(`This workspace was saved by a newer Satchel (format ${rootJson.version}). Update Satchel to open it.`);
  }

  let local = emptyLocalState();
  const localText = files.get(LOCAL_FILE);
  if (localText !== undefined) {
    try {
      local = parseLocalState(parseJsonFile(localText));
    } catch (err) {
      if (!(err instanceof FileError)) throw err;
      // Personal state only: start fresh rather than refusing to open.
      problems.push({ path: LOCAL_FILE, message: `${err.message}; your active environment and secret values were reset`, severity: "warning" });
    }
  }
  if (secrets) {
    const nested = (a: Record<string, Record<string, string>>, b: Record<string, Record<string, string>>) =>
      Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((id) => [id, { ...a[id], ...b[id] }]));
    local.secrets = {
      globals: { ...local.secrets.globals, ...secrets.globals },
      collections: nested(local.secrets.collections, secrets.collections),
      environments: nested(local.secrets.environments, secrets.environments),
    };
  }

  const paths = [...files.keys()];
  const seenIds = new Set<string>();
  /** The file's id, or a stable one from its path when missing or already taken (a copied file). */
  const idFor = (path: string, json: unknown): string => {
    const raw = isRecord(json) && typeof json.id === "string" && json.id ? json.id : null;
    let id = raw ?? `path:${path}`;
    if (seenIds.has(id)) {
      problems.push({ path, message: `has the same id as another file (was it copied?); it was given a new one`, severity: "warning" });
      id = `path:${path}`;
    }
    seenIds.add(id);
    return id;
  };

  const readItems = (dir: string, containerJson: Record<string, unknown>): TreeNode[] => {
    const { dirs, files: names } = listDir(paths, dir);
    const entries = [
      ...dirs.filter((d) => files.has(`${dir}/${d}/${FOLDER_FILE}`)),
      ...names.filter((n) => n.endsWith(REQUEST_SUFFIX)),
    ];
    const items: TreeNode[] = [];
    for (const name of ordered(containerJson.order, entries)) {
      const path = `${dir}/${name}`;
      if (name.endsWith(REQUEST_SUFFIX)) {
        try {
          const json = parseJsonFile(files.get(path)!);
          const id = idFor(path, json);
          items.push({ type: "request", id, request: parseRequest(json, id, root, local) });
        } catch (err) {
          fail(path, err);
        }
      } else {
        const folderPath = `${path}/${FOLDER_FILE}`;
        try {
          const json = parseJsonFile(files.get(folderPath)!);
          if (!isRecord(json)) throw new FileError("should be a JSON object");
          const folder: FolderNode = { type: "folder", id: idFor(folderPath, json), name: str(json.name, name), children: readItems(path, json) };
          items.push(folder);
        } catch (err) {
          // Without its folder.json the folder's requests can't be placed: protect the whole directory.
          fail(folderPath, err, `${path}/`);
        }
      }
    }
    return items;
  };

  const collections: Collection[] = [];
  const collectionDirs = listDir(paths, COLLECTIONS_DIR).dirs.filter((d) => files.has(`${COLLECTIONS_DIR}/${d}/${COLLECTION_FILE}`));
  for (const dirName of ordered(rootJson.collections, collectionDirs)) {
    const dir = `${COLLECTIONS_DIR}/${dirName}`;
    const path = `${dir}/${COLLECTION_FILE}`;
    try {
      const json = parseJsonFile(files.get(path)!);
      if (!isRecord(json)) throw new FileError("should be a JSON object");
      const id = idFor(path, json);
      collections.push({
        id,
        name: str(json.name, dirName),
        variables: withSecrets(keyValues(json.variables, "variables"), local.secrets.collections[id]),
        items: readItems(dir, json),
      });
    } catch (err) {
      fail(path, err, `${dir}/`);
    }
  }

  const environments: Environment[] = [];
  const envFiles = listDir(paths, ENVIRONMENTS_DIR).files.filter((f) => f.endsWith(".json"));
  for (const name of ordered(rootJson.environments, envFiles)) {
    const path = `${ENVIRONMENTS_DIR}/${name}`;
    try {
      const json = parseJsonFile(files.get(path)!);
      if (!isRecord(json)) throw new FileError("should be a JSON object");
      const id = idFor(path, json);
      const env: Environment = {
        id,
        name: str(json.name, name.replace(/\.json$/, "")),
        variables: withSecrets(keyValues(json.variables, "variables"), local.secrets.environments[id]),
      };
      if (typeof json.color === "string") env.color = json.color;
      environments.push(env);
    } catch (err) {
      fail(path, err);
    }
  }

  let globals: KeyValue[] = [];
  try {
    globals = withSecrets(keyValues(rootJson.globals, "globals"), local.secrets.globals);
  } catch (err) {
    fail(ROOT_FILE, err);
  }

  const activeEnvironmentId = environments.some((e) => e.id === local.activeEnvironmentId) ? local.activeEnvironmentId : null;
  return { workspace: { collections, environments, activeEnvironmentId, globals }, problems, protectedPaths };
}
