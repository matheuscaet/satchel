/**
 * The workspace folder format (version 1). A workspace is a directory —
 * usually a git repository shared by a team:
 *
 *   satchel.json                         format marker, order of collections and environments, globals
 *   collections/<dir>/collection.json    a collection: id, name, variables, order of its entries
 *   collections/<dir>/<dir>/folder.json  a folder: id, name, order of its entries
 *   collections/<dir>/…/<name>.request.json   one request per file
 *   environments/<name>.json             one environment per file
 *   .satchel/local.json                  per-person state, never shared: active environment, secret values
 *   .satchel/.gitignore                  "*" — keeps .satchel/ out of git without touching the repo's own .gitignore
 *
 * File and directory names are slugs of display names; the stable identity is
 * the `id` inside each file. Every file is pretty-printed JSON with a fixed key
 * order, so a change to one request is a small diff in one file.
 */

export const FORMAT_ID = "satchel-workspace";
export const FORMAT_VERSION = 1;

export const ROOT_FILE = "satchel.json";
export const COLLECTIONS_DIR = "collections";
export const ENVIRONMENTS_DIR = "environments";
export const COLLECTION_FILE = "collection.json";
export const FOLDER_FILE = "folder.json";
export const REQUEST_SUFFIX = ".request.json";
export const LOCAL_DIR = ".satchel";
export const LOCAL_FILE = `${LOCAL_DIR}/local.json`;
export const LOCAL_GITIGNORE = `${LOCAL_DIR}/.gitignore`;

/** Relative path → file content. Paths always use "/" separators. */
export type FileMap = Map<string, string>;

/**
 * Files this format owns. Only these are ever rewritten or deleted; anything
 * else in the folder (README, CI config, notes) is left alone.
 */
export function isManagedPath(path: string): boolean {
  if (path === ROOT_FILE || path === LOCAL_FILE || path === LOCAL_GITIGNORE) return true;
  if (path.startsWith(`${ENVIRONMENTS_DIR}/`)) return path.endsWith(".json") && !path.slice(ENVIRONMENTS_DIR.length + 1).includes("/");
  if (path.startsWith(`${COLLECTIONS_DIR}/`)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return name === COLLECTION_FILE || name === FOLDER_FILE || name.endsWith(REQUEST_SUFFIX);
  }
  return false;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Pretty-printed JSON with a trailing newline (what git and editors expect). */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
