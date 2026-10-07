import type { WorkspaceSource } from "@/state/sources";

/**
 * Which collections and folders are closed, per workspace, so the tree opens the way it was left.
 * Closed ids rather than open ones: anything new (an import, a teammate's folder) starts open.
 */

const PREFIX = "satchel.tree.closed:";
/** More than any real tree has containers; keeps a runaway list out of storage. */
const MAX_IDS = 5000;

export function treeStateKey(source: WorkspaceSource): string {
  if (source.kind === "folder") return `${PREFIX}folder:${source.root}`;
  if (source.kind === "file") return `${PREFIX}file:${source.path}`;
  return `${PREFIX}app`;
}

export function loadClosed(key: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** The closed ids worth keeping: those of containers that still exist. */
export function closedToStore(closed: ReadonlySet<string>, containers: readonly string[]): string[] {
  const live = new Set(containers);
  return [...closed].filter((id) => live.has(id)).slice(0, MAX_IDS);
}

export function saveClosed(key: string, ids: readonly string[]) {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // storage full or unavailable: the tree just opens fully next time
  }
}
