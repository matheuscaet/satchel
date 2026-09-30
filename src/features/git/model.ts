import { describeChanges, GROUP_LABEL, type ChangeGroup, type DescribedChange } from "@/git/describe";
import type { ChangeKind, GitStatus } from "@/git/status";

/**
 * Pure helpers for the source control panel: sections, the commit
 * selection, labels. Selection is kept as the set of *excluded* paths, so
 * a change that appears while the panel is open starts selected.
 */

export interface ChangeSection {
  group: ChangeGroup;
  label: string;
  changes: DescribedChange[];
}

/** Consecutive changes of the same group (describeChanges already orders them) → sections. */
export function sectionChanges(changes: readonly DescribedChange[]): ChangeSection[] {
  const out: ChangeSection[] = [];
  for (const c of changes) {
    const last = out[out.length - 1];
    if (last && last.group === c.group) last.changes.push(c);
    else out.push({ group: c.group, label: GROUP_LABEL[c.group], changes: [c] });
  }
  return out;
}

/** A conflicted file can't be committed until it's resolved. */
export function canSelect(change: Pick<DescribedChange, "kind">): boolean {
  return change.kind !== "conflicted";
}

export function isSelected(change: DescribedChange, excluded: ReadonlySet<string>): boolean {
  return canSelect(change) && !excluded.has(change.path);
}

/** The paths to commit, in list order. */
export function selectedPaths(changes: readonly DescribedChange[], excluded: ReadonlySet<string>): string[] {
  return changes.filter((c) => isSelected(c, excluded)).map((c) => c.path);
}

export type SelectionState = "all" | "some" | "none";

export function selectionState(changes: readonly DescribedChange[], excluded: ReadonlySet<string>): SelectionState {
  const selectable = changes.filter(canSelect);
  const selected = selectable.filter((c) => !excluded.has(c.path)).length;
  if (selectable.length > 0 && selected === selectable.length) return "all";
  return selected === 0 ? "none" : "some";
}

/** "Select all / none": everything selected → nothing; otherwise → everything. Forgets paths that are gone. */
export function toggleAll(changes: readonly DescribedChange[], excluded: ReadonlySet<string>): Set<string> {
  return selectionState(changes, excluded) === "all" ? new Set(changes.filter(canSelect).map((c) => c.path)) : new Set();
}

export function toggleOne(excluded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(excluded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export interface KindBadge {
  letter: string;
  label: string;
  className: string;
}

/** Status letters as `git status --short` writes them ("?" untracked, "U" unmerged). */
export const KIND_BADGE: Record<ChangeKind, KindBadge> = {
  modified: { letter: "M", label: "Modified", className: "text-warn" },
  added: { letter: "A", label: "New", className: "text-ok" },
  deleted: { letter: "D", label: "Deleted", className: "text-err" },
  renamed: { letter: "R", label: "Renamed or moved", className: "text-m-get" },
  untracked: { letter: "?", label: "New (not tracked yet)", className: "text-ok" },
  conflicted: { letter: "U", label: "Merge conflict", className: "text-err" },
};

/** "Shop API › Auth › Login" → leaf "Login", trail "Shop API › Auth". */
export function splitTitle(title: string): { leaf: string; trail: string } {
  const parts = title.split(" › ");
  const leaf = parts.pop() ?? title;
  return { leaf, trail: parts.join(" › ") };
}

/** A rename's old location in the app's terms ("Shop API › Auth › Sign in"), or its path. */
export function renamedFrom(change: DescribedChange): string | null {
  if (!change.origPath) return null;
  return describeChanges([{ path: change.origPath, kind: "deleted", index: "D", worktree: "." }], new Map())[0].title;
}

/** Requests and environments can be opened from the list (collections/folders have no view of their own). */
export function canOpen(change: DescribedChange): boolean {
  return !!change.entityId && change.kind !== "deleted" && (change.group === "requests" || change.group === "environments");
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function commitLabel(n: number): string {
  return n === 0 ? "Commit" : `Commit ${plural(n, "file")}`;
}

/** The branch, or the short commit when HEAD is detached. */
export function branchLabel(status: Pick<GitStatus, "branch" | "commit">): string {
  return status.branch ?? status.commit ?? "HEAD";
}

/** "↑2 ↓1", only the non-zero parts; "" when in sync. */
export function aheadBehind(status: Pick<GitStatus, "ahead" | "behind">): string {
  return [status.ahead ? `↑${status.ahead}` : "", status.behind ? `↓${status.behind}` : ""].filter(Boolean).join(" ");
}

/** First line of a (possibly long) git error, and the rest ("" when there's none). */
export function errorSummary(text: string): { first: string; rest: string } {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim());
  return { first: lines[0] ?? "", rest: lines.slice(1).join("\n") };
}
