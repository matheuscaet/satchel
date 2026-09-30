import { isManagedPath, type FileMap } from "@/folderFormat";

/** Where the workspace lives: the app cache (nothing chosen yet), a legacy .json file, or a workspace folder. */
export type WorkspaceSource = { kind: "cache" } | { kind: "file"; path: string } | { kind: "folder"; root: string };

const SOURCE_KEY = "satchel.source";
/** Written by builds before workspace folders; read once to migrate. */
const LEGACY_PATH_KEY = "satchel.filePath";
const RECENTS_KEY = "satchel.recentFolders";
export const MAX_RECENTS = 8;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the source just won't be remembered
  }
}

export function loadSource(): WorkspaceSource {
  const raw = read(SOURCE_KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s?.kind === "folder" && typeof s.root === "string") return { kind: "folder", root: s.root };
      if (s?.kind === "file" && typeof s.path === "string") return { kind: "file", path: s.path };
    } catch {
      // fall through
    }
  }
  const legacy = read(LEGACY_PATH_KEY);
  return legacy ? { kind: "file", path: legacy } : { kind: "cache" };
}

export function storeSource(source: WorkspaceSource) {
  write(SOURCE_KEY, source.kind === "cache" ? null : JSON.stringify(source));
  write(LEGACY_PATH_KEY, null);
}

export function loadRecents(): string[] {
  try {
    const list = JSON.parse(read(RECENTS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function storeRecents(list: readonly string[]) {
  write(RECENTS_KEY, JSON.stringify(list));
}

const sameFolder = (a: string, b: string) => a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");

/** `root` moved to the front, without duplicates, capped. */
export function withRecent(list: readonly string[], root: string): string[] {
  return [root, ...list.filter((p) => !sameFolder(p, root))].slice(0, MAX_RECENTS);
}

export function withoutRecent(list: readonly string[], root: string): string[] {
  return list.filter((p) => !sameFolder(p, root));
}

export function fileMapsEqual(a: FileMap, b: FileMap): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** What changed from `before` to `after`: each path's new content, or null when it's gone. */
export function changedFiles(before: FileMap, after: FileMap): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [k, v] of after) if (before.get(k) !== v) out.set(k, v);
  for (const k of before.keys()) if (!after.has(k)) out.set(k, null);
  return out;
}

/** A file one of our saves wrote (its content) or deleted (null), and when. */
export interface RecentWrite {
  content: string | null;
  at: number;
}

/**
 * Whether the paths a folder watcher reported can be our own recent writes coming back: each is
 * a file written within `windowMs` of `now`, or a directory with such a file inside (one we created
 * or emptied). Returns the files to compare with the disk to be sure, or null when some change
 * isn't ours.
 */
export function ownEchoCandidates(
  paths: Iterable<string>,
  recent: ReadonlyMap<string, RecentWrite>,
  now: number,
  windowMs: number,
): Map<string, string | null> | null {
  const fresh = [...recent].filter(([, w]) => now - w.at <= windowMs);
  const ours = new Map(fresh.map(([rel, w]) => [rel, w.content]));
  const expected = new Map<string, string | null>();
  for (const rel of paths) {
    const content = ours.get(rel);
    if (content !== undefined) expected.set(rel, content);
    else if (isManagedPath(rel) || !fresh.some(([p]) => p.startsWith(`${rel}/`))) return null;
  }
  return expected;
}

/** Last path segment, for display ("~/code/shop-api" → "shop-api"). */
export function folderName(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
}
