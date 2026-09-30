import { dirname, isManagedPath, type FileMap } from "./layout";

export interface WritePlan {
  /** files to create or overwrite (content differs from disk) */
  writes: [path: string, content: string][];
  /** managed files that no longer belong to the workspace */
  deletes: string[];
  /** directories that may be empty after the deletes, deepest first (the store removes the empty ones) */
  pruneDirs: string[];
}

function isProtected(path: string, protectedPaths: readonly string[]): boolean {
  return protectedPaths.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/**
 * What to change on disk to go from `current` (the managed files as last
 * read or written) to `next` (the workspace as it should be). Only files the
 * format owns are ever deleted, and protected paths (files that failed to
 * load) are neither written nor deleted.
 */
export function planWrite(current: FileMap, next: FileMap, protectedPaths: readonly string[] = []): WritePlan {
  const writes: [string, string][] = [];
  for (const [path, content] of next) {
    if (isProtected(path, protectedPaths)) continue;
    if (current.get(path) !== content) writes.push([path, content]);
  }
  const deletes = [...current.keys()].filter((p) => !next.has(p) && isManagedPath(p) && !isProtected(p, protectedPaths)).sort();

  const dirs = new Set<string>();
  for (const p of deletes) for (let d = dirname(p); d && d !== "collections" && d !== "environments"; d = dirname(d)) dirs.add(d);
  const pruneDirs = [...dirs].sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  return { writes: writes.sort((a, b) => a[0].localeCompare(b[0])), deletes, pruneDirs };
}

/** The file map after applying a plan (what the store should remember as "current"). */
export function applyPlanToMap(current: FileMap, plan: WritePlan): FileMap {
  const out = new Map(current);
  for (const p of plan.deletes) out.delete(p);
  for (const [p, c] of plan.writes) out.set(p, c);
  return out;
}
