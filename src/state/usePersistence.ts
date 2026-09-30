import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { exists, watch } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import type { Workspace } from "@/types";
import { emptyWorkspace, parseWorkspace } from "@/workspace";
import { basename, pickOpenLocation, pickSaveLocation, readWorkspaceFile, writeWorkspaceFile } from "@/fileStore";
import { createWorkspaceFolder, filesMatch, openWorkspaceFolder, readFolderSecrets, readManagedFiles, saveWorkspaceFolder, type FolderSecrets } from "@/folderStore";
import { filesToWorkspace, isManagedPath, relativeInside, ROOT_FILE, WorkspaceFolderError, type FileMap, type Problem } from "@/folderFormat";
import { isTauri } from "@/platform";
import { errorMessage } from "@/lib/errors";
import { APP_ACCOUNT, loadSecretValues, saveSecretValues } from "@/secrets/secretStore";
import { hasSecretValues, secretValuesOf, withoutSecretValues, withSecretValues } from "@/secrets/values";
import {
  changedFiles,
  fileMapsEqual,
  folderName,
  loadRecents,
  loadSource,
  ownEchoCandidates,
  storeRecents,
  storeSource,
  withoutRecent,
  withRecent,
  type RecentWrite,
  type WorkspaceSource,
} from "./sources";

/**
 * Keeps the in-memory workspace and its source in step:
 * - cache: the app's localStorage scratch space, before anything is chosen
 * - file: a legacy single .json file
 * - folder: a workspace folder (usually a git repository), written file by file
 *
 * Saving is automatic and debounced (it is not git sync: nothing is committed
 * or pushed). A folder is watched, so a `git pull` or a branch switch in a
 * terminal reloads the workspace; changes on disk win over unsaved ones.
 * The watcher tells our own writes coming back from outside changes, so an
 * autosave doesn't re-read the whole folder.
 */

/** The app's scratch workspace, used while no file or folder is chosen. */
const CACHE_KEY = "satchel.workspace.cache";
/**
 * A copy of the last opened file/folder as last loaded or saved, shown while it
 * (re)loads so tabs and the tree don't flash empty.
 */
const MIRROR_KEY = "satchel.workspace.mirror";
const SAVE_DELAY = 400;
const RELOAD_DELAY = 250;
/** How long after a save the watcher takes events on the files it wrote for our own echo. */
const ECHO_WINDOW = 2000;

export type SaveState = "saved" | "saving" | "cache" | "error";

export type OpenFolderResult =
  | { status: "opened"; root: string; problems: number }
  | { status: "cancelled" }
  /** The folder has no satchel.json: offer to create a workspace there. */
  | { status: "not-workspace"; root: string }
  | { status: "failed"; message: string };

function loadStored(key: string): Workspace {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parseWorkspace({ ...emptyWorkspace(), ...JSON.parse(raw) }) : emptyWorkspace();
  } catch {
    return emptyWorkspace();
  }
}

function store(key: string, w: Workspace) {
  try {
    localStorage.setItem(key, JSON.stringify(w));
  } catch {
    // storage full or unavailable
  }
}

/** The app's workspace as stored: localStorage holds it without secret values (they're in the keychain). */
const loadCache = () => loadStored(CACHE_KEY);

/** The app's workspace with its secret values from the keychain (as stored, when they can't be read). */
async function loadCacheWithSecrets(): Promise<Workspace> {
  const w = loadCache();
  try {
    const values = await loadSecretValues(APP_ACCOUNT);
    return values ? withSecretValues(w, values) : w;
  } catch {
    return w;
  }
}

/** The app's workspace: secret values to the keychain, the rest to localStorage. */
async function storeCache(w: Workspace) {
  store(CACHE_KEY, withoutSecretValues(w));
  await saveSecretValues(APP_ACCOUNT, secretValuesOf(w));
}

/**
 * The mirror is only a first-frame preview of the file or folder, which holds the real values
 * (a folder's secrets are in the keychain): secret values stay out of localStorage.
 */
function storeMirror(w: Workspace) {
  store(MIRROR_KEY, withoutSecretValues(w));
}

/** What to show on the very first render, before the file or folder has been read. */
export function initialWorkspace(): Workspace {
  return loadSource().kind === "cache" ? loadCache() : loadStored(MIRROR_KEY);
}

const message = errorMessage;

async function pickFolder(title: string): Promise<string | null> {
  if (!isTauri()) throw new Error("Workspace folders need the desktop app — run with `npm run tauri dev`.");
  const picked = await openDialog({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

export function usePersistence(workspace: Workspace, setWorkspace: (w: Workspace) => void) {
  const [source, setSourceState] = useState<WorkspaceSource>(loadSource);
  const [saveState, setSaveState] = useState<SaveState>(() => (loadSource().kind === "cache" ? "cache" : "saved"));
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [recentFolders, setRecents] = useState<string[]>(loadRecents);

  // Folder bookkeeping lives in refs: the save/reload callbacks read it between renders.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  /** managed files as last read or written — the baseline for the next save */
  const baseline = useRef<FileMap>(new Map());
  const protectedPaths = useRef<string[]>([]);
  /** the next workspace change came from disk (or a switch), not the user: don't save it back */
  // true at first: the initial render shows the cache/mirror, which must never be written over the real source
  const skipNextSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const reloadWanted = useRef(false);
  /** set when the folder stopped being a workspace (e.g. a branch without satchel.json): never write into it */
  const frozen = useRef(false);
  /** files our saves just wrote (content) or deleted (null), and when: the watcher's own echo */
  const recentWrites = useRef(new Map<string, RecentWrite>());
  /**
   * The source (and its secret values) has been read at least once. Until then the screen shows a
   * stored copy without secret values: an edit made in that moment must not be saved over them.
   */
  const loaded = useRef(false);
  /** the workspace the autosave effect last handled (a re-run with the same one, e.g. StrictMode's, is a no-op) */
  const handled = useRef<Workspace | null>(null);

  const setSource = useCallback((s: WorkspaceSource) => {
    storeSource(s);
    sourceRef.current = s;
    setSourceState(s);
    if (s.kind === "folder") {
      setRecents((list) => {
        const next = withRecent(list, s.root);
        storeRecents(next);
        return next;
      });
    }
  }, []);

  /** Replace the in-memory workspace without writing it back. */
  const adopt = useCallback(
    (w: Workspace) => {
      loaded.current = true;
      // The same object wouldn't re-render, and the skip would swallow the next edit's save instead.
      if (w !== workspaceRef.current) {
        skipNextSave.current = true;
        setWorkspace(w);
      }
      // Just loaded from the file or folder: what the next launch shows first. (The cache is where it came from.)
      if (sourceRef.current.kind !== "cache") storeMirror(w);
    },
    [setWorkspace],
  );

  const noteWrites = (before: FileMap, after: FileMap) => {
    const now = Date.now();
    const recent = recentWrites.current;
    for (const [rel, w] of recent) if (now - w.at > ECHO_WINDOW) recent.delete(rel);
    for (const [rel, content] of changedFiles(before, after)) recent.set(rel, { content, at: now });
  };

  const applyFolderLoad = useCallback(
    (root: string, files: FileMap, secrets: FolderSecrets) => {
      const load = filesToWorkspace(files, root, secrets.values);
      frozen.current = false;
      baseline.current = files;
      protectedPaths.current = load.protectedPaths;
      setProblems(load.problems);
      adopt(load.workspace);
      return load;
    },
    [adopt],
  );

  const cancelPendingSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
  };

  /** Write the workspace to its source now (one write at a time). */
  const writeNow = useCallback((w: Workspace): Promise<void> => {
    const run = async () => {
      const s = sourceRef.current;
      if (s.kind === "cache") return storeCache(w).catch((err) => setError(message(err, "Couldn't save the secret values.")));
      busy.current = true;
      setSaveState("saving");
      try {
        if (s.kind === "file") await writeWorkspaceFile(s.path, w);
        else if (frozen.current) {
          setSaveState("error");
          return;
        } else {
          const before = baseline.current;
          baseline.current = await saveWorkspaceFolder(s.root, w, before, protectedPaths.current);
          noteWrites(before, baseline.current);
        }
        storeMirror(w);
        setSaveState("saved");
      } catch (err) {
        setSaveState("error");
        setError(message(err, "Couldn't save the workspace."));
      } finally {
        busy.current = false;
      }
    };
    saving.current = saving.current.then(run, run);
    return saving.current;
  }, []);

  /** After a folder load: say what the keychain couldn't do, and move plain-text secrets into it. */
  const settleSecrets = useCallback(
    (secrets: FolderSecrets, w: Workspace) => {
      if (secrets.error) {
        setError(
          `Couldn't read the secret values from the system keychain (${secrets.error}). They're left as they are there, and edits to them aren't saved; reopen the workspace to try again.`,
        );
      }
      if (secrets.migrate) void writeNow(w);
    },
    [writeNow],
  );

  /** Save whatever is pending right away (before switching to another workspace). */
  const flush = useCallback(async () => {
    if (saveTimer.current) {
      cancelPendingSave();
      await writeNow(workspaceRef.current);
    } else {
      await saving.current;
    }
  }, [writeNow]);

  // Autosave, debounced: into the app cache until a file or folder is chosen, into that after.
  useEffect(() => {
    if (handled.current === workspace) return;
    handled.current = workspace;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (!loaded.current) return; // the source's own content replaces this as soon as it's read
    if (sourceRef.current.kind !== "cache") setSaveState("saving");
    cancelPendingSave();
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void writeNow(workspace).then(() => {
        if (reloadWanted.current) void reloadFromDisk();
      });
    }, SAVE_DELAY);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloadFromDisk is stable in practice
  }, [workspace, writeNow]);

  // An edit still waiting for the cache's debounce isn't lost when the app closes or reloads.
  useEffect(() => {
    const writePending = () => {
      if (!saveTimer.current || sourceRef.current.kind !== "cache") return;
      cancelPendingSave();
      void storeCache(workspaceRef.current);
    };
    window.addEventListener("pagehide", writePending);
    window.addEventListener("beforeunload", writePending);
    return () => {
      window.removeEventListener("pagehide", writePending);
      window.removeEventListener("beforeunload", writePending);
    };
  }, []);

  /** Stop writing into the folder (it isn't a usable workspace right now) and say why. */
  const freeze = (why: string) => {
    frozen.current = true;
    cancelPendingSave();
    setSaveState("error");
    setError(why);
  };

  /** Re-read the folder; adopt it when it differs from what we last wrote. */
  const reloadFromDisk = useCallback(async (): Promise<boolean> => {
    const s = sourceRef.current;
    if (s.kind !== "folder") return false;
    if (busy.current) {
      reloadWanted.current = true; // our own write is in flight: check again once it's done
      return false;
    }
    reloadWanted.current = false;
    let files: FileMap;
    let secrets: FolderSecrets;
    try {
      files = await readManagedFiles(s.root);
      secrets = await readFolderSecrets(files); // remembered after the first read: no keychain round trip
    } catch (err) {
      setError(message(err, "Couldn't read the workspace folder."));
      return false;
    }
    if (sourceRef.current !== s) return false;
    if (busy.current) {
      reloadWanted.current = true; // a write started while reading: look again once it's done
      return false;
    }
    // Unchanged since our last read/write — unless saving was frozen, then an identical folder is the all-clear.
    if (!frozen.current && fileMapsEqual(files, baseline.current)) return false;
    if (!files.has(ROOT_FILE)) {
      freeze(`${folderName(s.root)} no longer has a ${ROOT_FILE} (was the branch switched?). Changes aren't saved until it's back.`);
      return false;
    }
    try {
      cancelPendingSave(); // the disk wins over edits that weren't saved yet
      settleSecrets(secrets, applyFolderLoad(s.root, files, secrets).workspace);
    } catch (err) {
      if (!(err instanceof WorkspaceFolderError)) throw err;
      freeze(`${err.message} Changes aren't saved until it's fixed.`);
      return false;
    }
    setSaveState("saved");
    return true;
  }, [applyFolderLoad, settleSecrets]);

  /**
   * Whether changed paths the watcher reported are only our own saves coming back: each one is a
   * file we wrote or deleted moments ago that is still as we left it, or a directory we wrote into.
   */
  const isOwnEcho = useCallback(async (root: string, paths: ReadonlySet<string>): Promise<boolean> => {
    await saving.current; // a write in flight is noted once it's done
    if (frozen.current) return false; // the reload decides when saving can resume
    const expected = ownEchoCandidates(paths, recentWrites.current, Date.now(), ECHO_WINDOW);
    return expected !== null && filesMatch(root, expected);
  }, []);

  // Watch the open folder for changes made outside the app (git pull, checkout, an editor).
  useEffect(() => {
    if (source.kind !== "folder" || !isTauri()) return;
    const root = source.root;
    let stop: (() => void) | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** relevant paths reported since the last check */
    let changed = new Set<string>();
    watch(
      root,
      (event) => {
        // Opening and reading files (our own reloads, git status) changes nothing.
        if (typeof event.type === "object" && "access" in event.type) return;
        for (const p of event.paths) {
          const rel = relativeInside(root, p);
          if (rel !== null && !rel.startsWith(".git/") && (isManagedPath(rel) || rel === "collections" || rel.startsWith("collections/") || rel.startsWith("environments"))) {
            changed.add(rel);
          }
        }
        if (changed.size === 0) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const paths = changed;
          changed = new Set();
          void (async () => {
            if (await isOwnEcho(root, paths)) return;
            if (cancelled) return;
            if (await reloadFromDisk()) toast("Workspace reloaded: files changed on disk.");
          })();
        }, RELOAD_DELAY);
      },
      { recursive: true, delayMs: 200 },
    )
      .then((unwatch) => {
        if (cancelled) unwatch();
        else stop = unwatch;
      })
      .catch((err) => setError(message(err, "Couldn't watch the workspace folder for changes.")));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stop?.();
    };
  }, [source, reloadFromDisk, isOwnEcho]);

  // Reopen what was open last time.
  useEffect(() => {
    const s = sourceRef.current;
    if (s.kind === "cache") {
      // localStorage has the workspace without its secret values: they come from the keychain.
      // A cache saved before the keychain still holds them in plain text; saving moves them.
      const inline = hasSecretValues(secretValuesOf(workspaceRef.current));
      loadSecretValues(APP_ACCOUNT)
        .then((values) => {
          const w = values ? withSecretValues(workspaceRef.current, values) : workspaceRef.current;
          adopt(w);
          if (inline) void writeNow(w);
        })
        .catch((err) => {
          adopt(workspaceRef.current);
          setError(
            `Couldn't read the secret values from the system keychain (${message(err, "unknown error")}). Edits to them aren't saved until it can be read.`,
          );
        });
    } else if (s.kind === "file") {
      readWorkspaceFile(s.path)
        .then(adopt)
        .catch(() => {
          setSource({ kind: "cache" });
          setSaveState("cache");
          setError(`Couldn't reopen ${basename(s.path)}. It may have moved or been deleted, so your last cached copy is shown.`);
          void loadCacheWithSecrets().then(adopt);
        });
    } else if (s.kind === "folder") {
      const giveUp = (why: string) => {
        setSource({ kind: "cache" });
        setSaveState("cache");
        setError(`Couldn't reopen ${folderName(s.root)}: ${why}. The app's own workspace is shown instead.`);
        void loadCacheWithSecrets().then(adopt);
      };
      exists(s.root)
        .then(async (there) => {
          if (!there) return giveUp("the folder is gone (moved, renamed, or on a drive that isn't mounted)");
          const opened = await openWorkspaceFolder(s.root).catch((err) => err as Error);
          if (!(opened instanceof Error)) return settleSecrets(opened.secrets, applyFolderLoad(s.root, opened.files, opened.secrets).workspace);
          if (!(opened instanceof WorkspaceFolderError)) return giveUp(message(opened, "it couldn't be read"));
          // e.g. satchel.json mid-merge: stay on the folder, show the last copy, and wait for the fix (the watcher reloads).
          freeze(`${folderName(s.root)}: ${opened.message} Changes aren't saved until it's fixed.`);
        })
        .catch((err) => giveUp(message(err, "it couldn't be read")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  /** Open a workspace folder (asks for one when `root` is omitted). */
  const openFolder = useCallback(
    async (root?: string): Promise<OpenFolderResult> => {
      setError(null);
      try {
        const picked = root ?? (await pickFolder("Open a workspace folder"));
        if (!picked) return { status: "cancelled" };
        const files = await readManagedFiles(picked);
        if (!files.has(ROOT_FILE)) return { status: "not-workspace", root: picked };
        await flush();
        const secrets = await readFolderSecrets(files);
        const load = filesToWorkspace(files, picked, secrets.values); // throws on an unusable satchel.json
        setSource({ kind: "folder", root: picked });
        frozen.current = false;
        baseline.current = files;
        protectedPaths.current = load.protectedPaths;
        setProblems(load.problems);
        adopt(load.workspace);
        setSaveState("saved");
        settleSecrets(secrets, load.workspace);
        return { status: "opened", root: picked, problems: load.problems.length };
      } catch (err) {
        const msg = message(err, "Couldn't open that folder.");
        setError(msg);
        return { status: "failed", message: msg };
      }
    },
    [adopt, flush, setSource, settleSecrets],
  );

  /** Make `root` a workspace folder holding `from` (the current workspace, or an empty one), and switch to it. */
  const createFolderWorkspace = useCallback(
    async (root: string, from: "current" | "empty"): Promise<boolean> => {
      setError(null);
      try {
        await flush();
        const w = from === "current" ? workspaceRef.current : emptyWorkspace();
        const files = await createWorkspaceFolder(root, w);
        setSource({ kind: "folder", root });
        frozen.current = false;
        baseline.current = files;
        noteWrites(new Map(), files);
        protectedPaths.current = [];
        setProblems([]);
        adopt(w);
        setSaveState("saved");
        return true;
      } catch (err) {
        setError(message(err, "Couldn't create the workspace folder."));
        return false;
      }
    },
    [adopt, flush, setSource],
  );

  /** Convert what's open now into a new workspace folder ("Save as folder…"). */
  const saveAsFolder = useCallback(async (): Promise<boolean> => {
    try {
      const root = await pickFolder("Choose an empty folder (or a repository) for this workspace");
      return root ? createFolderWorkspace(root, "current") : false;
    } catch (err) {
      setError(message(err, "Couldn't save as a folder."));
      return false;
    }
  }, [createFolderWorkspace]);

  /** Stop using the folder or file; back to the app's scratch workspace. */
  const closeWorkspace = useCallback(async () => {
    await flush();
    const w = await loadCacheWithSecrets();
    setSource({ kind: "cache" });
    baseline.current = new Map();
    protectedPaths.current = [];
    setProblems([]);
    adopt(w);
    setSaveState("cache");
  }, [adopt, flush, setSource]);

  const forgetRecent = useCallback((root: string) => {
    setRecents((list) => {
      const next = withoutRecent(list, root);
      storeRecents(next);
      return next;
    });
  }, []);

  // Legacy single-file workspaces (.json)
  const openFile = useCallback(async () => {
    setError(null);
    try {
      const path = await pickOpenLocation();
      if (!path) return;
      const w = await readWorkspaceFile(path);
      await flush();
      setSource({ kind: "file", path });
      setProblems([]);
      adopt(w);
      setSaveState("saved");
    } catch (err) {
      setError(message(err, "Couldn't open that workspace file."));
    }
  }, [adopt, flush, setSource]);

  const saveFileAs = useCallback(async () => {
    setError(null);
    try {
      const path = await pickSaveLocation();
      if (!path) return;
      await flush();
      setSource({ kind: "file", path });
      setProblems([]);
      await writeNow(workspaceRef.current);
    } catch (err) {
      setError(message(err, "Couldn't save the workspace."));
    }
  }, [flush, setSource, writeNow]);

  const clearError = useCallback(() => setError(null), []);

  // One object per change of what's in it, so the workspace context stays stable between edits.
  return useMemo(
    () => ({
      source,
      /** folder name or file name; null for the app cache */
      sourceName: source.kind === "folder" ? folderName(source.root) : source.kind === "file" ? basename(source.path) : null,
      /** folder root or file path; null for the app cache */
      sourcePath: source.kind === "folder" ? source.root : source.kind === "file" ? source.path : null,
      saveState,
      error,
      clearError,
      /** files in the folder that couldn't be loaded (conflicts, invalid JSON) or were fixed up */
      problems,
      recentFolders,
      forgetRecent,
      openFolder,
      createFolderWorkspace,
      saveAsFolder,
      closeWorkspace,
      reloadFromDisk,
      /** Write pending edits now (e.g. before a git commit), and wait for any write in flight. */
      flush,
      openFile,
      saveFileAs,
    }),
    [
      source,
      saveState,
      error,
      clearError,
      problems,
      recentFolders,
      forgetRecent,
      openFolder,
      createFolderWorkspace,
      saveAsFolder,
      closeWorkspace,
      reloadFromDisk,
      flush,
      openFile,
      saveFileAs,
    ],
  );
}
