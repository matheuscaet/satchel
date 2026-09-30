/**
 * `git status --porcelain=v2 --branch -z` → a structured status.
 * Porcelain paths are relative to the repository root; `prefix` (from
 * `git rev-parse --show-prefix`) turns them into workspace-relative paths.
 */

export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface GitChange {
  /** workspace-relative, "/" separators */
  path: string;
  /** for renames: where it came from (workspace-relative) */
  origPath?: string;
  kind: ChangeKind;
  /** porcelain X (index) and Y (worktree) status letters, "?" for untracked */
  index: string;
  worktree: string;
}

export interface GitStatus {
  /** null when HEAD is detached */
  branch: string | null;
  /** short commit id, null before the first commit */
  commit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
}

function kindOf(x: string, y: string): ChangeKind {
  if (x === "D" || y === "D") return "deleted";
  if (x === "A") return "added";
  if (x === "R" || x === "C") return "renamed";
  return "modified";
}

function strip(prefix: string, path: string): string | null {
  if (!prefix) return path;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

export function parseStatus(raw: string, prefix = ""): GitStatus {
  const status: GitStatus = { branch: null, commit: null, upstream: null, ahead: 0, behind: 0, changes: [] };
  const fields = raw.split("\0");
  const add = (change: GitChange, repoPath: string, repoOrig?: string) => {
    const path = strip(prefix, repoPath);
    if (path === null || path === "") return; // outside the workspace folder
    const origPath = repoOrig !== undefined ? (strip(prefix, repoOrig) ?? undefined) : undefined;
    status.changes.push({ ...change, path, ...(origPath !== undefined ? { origPath } : {}) });
  };

  for (let i = 0; i < fields.length; i++) {
    const line = fields[i];
    if (!line) continue;
    if (line.startsWith("# ")) {
      const [, key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "branch.head") status.branch = value === "(detached)" ? null : value;
      else if (key === "branch.oid") status.commit = value === "(initial)" ? null : value.slice(0, 7);
      else if (key === "branch.upstream") status.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          status.ahead = Number(m[1]);
          status.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = line[0];
    if (type === "1") {
      // 1 XY sub mH mI mW hH hI path
      const parts = line.split(" ");
      const xy = parts[1];
      add({ path: "", kind: kindOf(xy[0], xy[1]), index: xy[0], worktree: xy[1] }, parts.slice(8).join(" "));
    } else if (type === "2") {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const parts = line.split(" ");
      const xy = parts[1];
      const orig = fields[++i];
      add({ path: "", kind: "renamed", index: xy[0], worktree: xy[1] }, parts.slice(9).join(" "), orig);
    } else if (type === "u") {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = line.split(" ");
      const xy = parts[1];
      add({ path: "", kind: "conflicted", index: xy[0], worktree: xy[1] }, parts.slice(10).join(" "));
    } else if (type === "?") {
      add({ path: "", kind: "untracked", index: "?", worktree: "?" }, line.slice(2));
    }
    // "!" (ignored) entries aren't requested
  }
  status.changes.sort((a, b) => a.path.localeCompare(b.path));
  return status;
}

/** Paths a commit of these changes must include (a rename's old path too, so the removal is committed). */
export function commitPaths(changes: readonly GitChange[]): string[] {
  const out = new Set<string>();
  for (const c of changes) {
    out.add(c.path);
    if (c.origPath) out.add(c.origPath);
  }
  return [...out];
}
