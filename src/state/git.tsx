import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { workspaceFileLabels, type FileLabel } from "@/folderFormat";
import { gitCommit, gitCommitMerge, gitFetch, gitInfo, gitInit, gitPull, gitPush, gitRemotes, gitStatus, gitVersion, type GitInfo } from "@/git/api";
import { describeChanges, type DescribedChange } from "@/git/describe";
import { commitPaths, parseStatus, type GitStatus } from "@/git/status";
import { errorMessage } from "@/lib/errors";
import { isTauri } from "@/platform";
import { useUi } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Git for the open workspace folder. Everything here is user-initiated
 * (buttons in the source control panel): the app shows what changed and
 * runs commit / pull / push / fetch when asked — never on its own.
 * Status is refreshed in the background, which only reads — and only while
 * the window has focus, one `git status` per tick; the repository info
 * (`git rev-parse`) is re-read when something suggests it changed.
 */

export type GitOperation = "commit" | "pull" | "push" | "fetch" | "init";

interface GitValue {
  /** null while checking; false when git isn't installed (or this isn't the desktop app) */
  available: boolean | null;
  /** why git isn't available */
  unavailableReason: string | null;
  /** null when no folder is open or it hasn't been checked yet */
  repo: GitInfo | null;
  status: GitStatus | null;
  /** status changes in the app's terms, grouped */
  changes: DescribedChange[];
  conflicts: number;
  /** the operation in progress, if any */
  busy: GitOperation | null;
  /** a refresh the user asked for is running (background ones don't show) */
  refreshing: boolean;
  /** the last operation's error, for the panel (background refreshes don't set it) */
  lastError: string | null;
  clearError: () => void;
  /** a merge or rebase in progress, e.g. after a pull that conflicted */
  operation: "merge" | "rebase" | null;
  refresh: () => Promise<void>;
  /**
   * Commit the given workspace-relative paths (and their rename sources).
   * During a merge this completes the merge instead: a merge can't be committed partially.
   */
  commit: (message: string, paths: string[]) => Promise<boolean>;
  pull: () => Promise<boolean>;
  /** Pushes; the first push of a branch sets its upstream on `origin` (or the only remote). */
  push: () => Promise<boolean>;
  fetch: () => Promise<boolean>;
  /** `git init` in the workspace folder */
  init: () => Promise<boolean>;
}

const GitContext = createContext<GitValue | null>(null);
/** Background refresh while the source control panel is open, and while it isn't. */
const POLL_OPEN_MS = 10_000;
const POLL_MS = 30_000;
/** The repository info is re-read at least this often (a merge or rebase started in a terminal). */
const INFO_MAX_AGE_MS = 60_000;
/** Focusing the window (or opening the panel) refreshes, unless a refresh just ran. */
const FOCUS_THROTTLE_MS = 2_000;
const NO_LABELS = new Map<string, FileLabel>();

/** The first lines of git's output: enough for a toast. */
function brief(text: string, lines = 3): string {
  const all = text.trim().split("\n").filter(Boolean);
  return all.slice(0, lines).join("\n") + (all.length > lines ? "\n…" : "");
}

const sameInfo = (a: GitInfo, b: GitInfo) => a.isRepo === b.isRepo && a.prefix === b.prefix && a.operation === b.operation;

const sameChange = (a: DescribedChange, b: DescribedChange) =>
  a.path === b.path &&
  a.origPath === b.origPath &&
  a.kind === b.kind &&
  a.index === b.index &&
  a.worktree === b.worktree &&
  a.group === b.group &&
  a.title === b.title &&
  a.method === b.method &&
  a.entityId === b.entityId;

/** A status that hints a merge or rebase started or ended: the info is worth re-reading. */
const looksLikeAnOperation = (status: GitStatus) => status.branch === null || status.changes.some((c) => c.kind === "conflicted");

export function GitProvider({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const panelOpen = useUi().sourceControlOpen;
  const root = ws.source.kind === "folder" ? ws.source.root : null;
  const { flush, reloadFromDisk } = ws;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [repo, setRepo] = useState<GitInfo | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState<GitOperation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const rootRef = useRef(root);
  rootRef.current = root;
  // What the last refresh read, so a tick where nothing changed doesn't re-render anything.
  const info = useRef<{ root: string; info: GitInfo; at: number } | null>(null);
  const infoStale = useRef(true);
  const statusKey = useRef<string | null>(null);
  const lastSync = useRef(0);
  // The latest state for the operations below, so they don't change identity with every refresh.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const repoRef = useRef(repo);
  repoRef.current = repo;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Is git there at all? (once)
  useEffect(() => {
    if (!isTauri()) {
      setAvailable(false);
      setUnavailableReason("Git needs the desktop app.");
      return;
    }
    gitVersion()
      .then(() => setAvailable(true))
      .catch((err) => {
        setAvailable(false);
        setUnavailableReason(errorMessage(err, "git isn't installed"));
      });
  }, []);

  /**
   * Re-read the status, and the repository info when it's due. One at a time: a background
   * tick joins a refresh that's already running, while one that must see the latest state
   * (`fresh`: after an operation or a folder change; `manual`: the user's) waits for it, then runs.
   */
  const sync = useCallback(
    async ({ fresh = false, manual = false }: { fresh?: boolean; manual?: boolean } = {}): Promise<void> => {
      if (fresh) infoStale.current = true;
      while (inflight.current) {
        if (!fresh && !manual) return inflight.current;
        await inflight.current;
      }
      const r = rootRef.current;
      if (!r || !available) return;
      lastSync.current = Date.now();
      const readInfo = async () => {
        infoStale.current = false;
        const next = await gitInfo(r);
        if (rootRef.current !== r) return null;
        info.current = { root: r, info: next, at: Date.now() };
        setRepo((prev) => (prev && sameInfo(prev, next) ? prev : next));
        return next;
      };
      const run = (async () => {
        if (manual) setRefreshing(true);
        try {
          const cached = info.current?.root === r ? info.current : null;
          const due = !cached || infoStale.current || Date.now() - cached.at > INFO_MAX_AGE_MS;
          const repoInfo = due ? await readInfo() : cached.info;
          if (!repoInfo) return;
          if (!repoInfo.isRepo) {
            statusKey.current = null;
            setStatus(null);
            return;
          }
          const raw = await gitStatus(r);
          if (rootRef.current !== r) return;
          const key = `${repoInfo.prefix}\0${raw}`;
          if (key === statusKey.current) return;
          statusKey.current = key;
          const next = parseStatus(raw, repoInfo.prefix);
          setStatus(next);
          // A merge or rebase started or finished in a terminal: show it now, not a minute later.
          if (!due && (repoInfo.operation || looksLikeAnOperation(next))) await readInfo();
        } catch {
          // A background refresh failing (e.g. the index is locked by a git command in a terminal)
          // isn't an operation the user ran: keep the last good status and try again on the next tick,
          // re-reading the info in case the folder stopped being a repository.
          infoStale.current = true;
        } finally {
          if (manual) setRefreshing(false);
        }
      })();
      inflight.current = run;
      void run.finally(() => {
        if (inflight.current === run) inflight.current = null;
      });
      return run;
    },
    [available],
  );

  const refresh = useCallback(() => sync({ fresh: true, manual: true }), [sync]);

  // A new folder: forget the old repository, read the new one.
  useEffect(() => {
    info.current = null;
    statusKey.current = null;
    setRepo(null);
    setStatus(null);
    setLastError(null);
    void sync({ fresh: true });
  }, [root, sync]);

  // Keep the status fresh: after each save, on focus, when the panel opens, and every few
  // seconds while the window has focus (more often while the panel is open).
  useEffect(() => {
    if (ws.saveState === "saved") void sync();
  }, [ws.saveState, sync]);
  useEffect(() => {
    if (!root) return;
    const tick = () => document.hasFocus() && void sync();
    const onFocus = () => Date.now() - lastSync.current >= FOCUS_THROTTLE_MS && void sync();
    const id = setInterval(tick, panelOpen ? POLL_OPEN_MS : POLL_MS);
    window.addEventListener("focus", onFocus);
    if (panelOpen) onFocus();
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [root, sync, panelOpen]);

  // Labels only matter for files that changed: with a clean tree, editing the workspace costs nothing here.
  const hasChanges = !!status?.changes.length;
  const labels = useMemo(() => (root && hasChanges ? workspaceFileLabels(ws.workspace) : NO_LABELS), [root, hasChanges, ws.workspace]);
  const describedRef = useRef<DescribedChange[]>([]);
  const changes = useMemo(() => {
    const next = status ? describeChanges(status.changes, labels) : [];
    const prev = describedRef.current;
    // An edit that didn't rename anything that changed describes the same list: keep it, so consumers don't re-render.
    if (next.length === prev.length && next.every((c, i) => sameChange(c, prev[i]))) return prev;
    return (describedRef.current = next);
  }, [status, labels]);
  const conflicts = useMemo(() => status?.changes.filter((c) => c.kind === "conflicted").length ?? 0, [status]);

  /** Run an operation: one at a time, errors kept for the panel and toasted. */
  const operate = useCallback(
    async (op: GitOperation, run: (root: string) => Promise<string | void>): Promise<boolean> => {
      const r = rootRef.current;
      if (!r || busyRef.current) return false;
      busyRef.current = op;
      setBusy(op);
      setLastError(null);
      try {
        const success = await run(r);
        if (success) toast(success);
        return true;
      } catch (err) {
        const msg = errorMessage(err, `git ${op} failed`);
        setLastError(msg);
        toast.error(brief(msg));
        return false;
      } finally {
        busyRef.current = null;
        setBusy(null);
        await sync({ fresh: true });
      }
    },
    [sync],
  );

  const clearError = useCallback(() => setLastError(null), []);

  const commit = useCallback(
    (message: string, paths: string[]) =>
      operate("commit", async (r) => {
        await flush(); // commit what's on screen, not what was on disk 400ms ago
        const operation = repoRef.current?.operation;
        if (operation === "rebase") throw new Error("A rebase is in progress. Finish it in a terminal (git rebase --continue or --abort).");
        if (operation === "merge") {
          await gitCommitMerge(r, message);
          return "Merge completed. Push when you're ready to share it.";
        }
        const selected = statusRef.current?.changes.filter((c) => paths.includes(c.path)) ?? [];
        const all = commitPaths(selected.length ? selected : paths.map((path) => ({ path, kind: "modified", index: ".", worktree: "M" })));
        await gitCommit(r, message, all);
        return `Committed ${paths.length} file${paths.length === 1 ? "" : "s"}. Push when you're ready to share it.`;
      }),
    [operate, flush],
  );

  const pull = useCallback(
    () =>
      operate("pull", async (r) => {
        await flush();
        const out = await gitPull(r);
        await reloadFromDisk(); // the watcher would too; don't wait for it
        const text = `${out.stdout}\n${out.stderr}`;
        return /Already up to date/i.test(text) ? "Already up to date." : "Pulled. The workspace was reloaded.";
      }),
    [operate, flush, reloadFromDisk],
  );

  const push = useCallback(
    () =>
      operate("push", async (r) => {
        const upstream = statusRef.current?.upstream;
        if (upstream) {
          await gitPush(r);
          return `Pushed to ${upstream}.`;
        }
        const remotes = await gitRemotes(r);
        const remote = remotes.includes("origin") ? "origin" : remotes[0];
        if (!remote) throw new Error("This repository has no remote yet. Add one (git remote add origin <url>), then push.");
        await gitPush(r, remote);
        return `Published ${statusRef.current?.branch ?? "the branch"} to ${remote}.`;
      }),
    [operate],
  );

  const fetch = useCallback(
    () =>
      operate("fetch", async (r) => {
        await gitFetch(r);
      }),
    [operate],
  );

  const init = useCallback(
    () =>
      operate("init", async (r) => {
        await gitInit(r);
        return "Initialized a git repository. Commit the workspace to start sharing it.";
      }),
    [operate],
  );

  const value = useMemo<GitValue>(
    () => ({
      available,
      unavailableReason,
      repo,
      status,
      changes,
      conflicts,
      busy,
      refreshing,
      lastError,
      clearError,
      operation: repo?.operation ?? null,
      refresh,
      commit,
      pull,
      push,
      fetch,
      init,
    }),
    [available, unavailableReason, repo, status, changes, conflicts, busy, refreshing, lastError, clearError, refresh, commit, pull, push, fetch, init],
  );

  return <GitContext.Provider value={value}>{children}</GitContext.Provider>;
}

export function useGit(): GitValue {
  const ctx = useContext(GitContext);
  if (!ctx) throw new Error("useGit must be used inside <GitProvider>");
  return ctx;
}
