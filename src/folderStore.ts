import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Workspace } from "./types";
import {
  applyPlanToMap,
  COLLECTIONS_DIR,
  detachSecrets,
  ENVIRONMENTS_DIR,
  filesToWorkspace,
  isManagedPath,
  LOCAL_FILE,
  LOCAL_GITIGNORE,
  localVault,
  planWrite,
  ROOT_FILE,
  workspaceToFiles,
  WorkspaceFolderError,
  type FileMap,
  type FolderLoad,
} from "./folderFormat";
import { folderAccount, loadSecretValues, saveSecretValues } from "./secrets/secretStore";
import type { SecretValues } from "./secrets/values";

/**
 * Workspace folders on disk (desktop app only). The pure format lives in
 * folderFormat/; this module only walks directories and applies write plans.
 */

/** Deeper than any real collection; stops a symlink loop or a runaway tree. */
const MAX_DEPTH = 24;
/** File operations in flight at once: enough to hide the IPC round trips, few enough not to flood them. */
const CONCURRENCY = 16;

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

/** Runs the tasks given to it at most `limit` at a time, in the order they came. */
function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve)); // a finishing task hands its slot over
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

type Limit = ReturnType<typeof limiter>;

/** The managed files under `rel`, read concurrently but listed in directory order. */
async function walk(root: string, rel: string, depth: number, limit: Limit): Promise<[string, string][]> {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await limit(() => readDir(join(root, rel)));
  } catch {
    return []; // the directory doesn't exist (yet) — nothing to read
  }
  const found = await Promise.all(
    entries.map(async (e): Promise<[string, string][]> => {
      if (e.isSymlink || e.name.startsWith(".")) return [];
      const path = `${rel}/${e.name}`;
      if (e.isDirectory) return walk(root, path, depth + 1, limit);
      if (e.isFile && isManagedPath(path)) return [[path, await limit(() => readTextFile(join(root, path)))]];
      return [];
    }),
  );
  return found.flat();
}

/** A file's content, or null when it's absent or unreadable. */
async function readIfThere(path: string): Promise<string | null> {
  try {
    return (await exists(path)) ? await readTextFile(path) : null;
  } catch {
    return null;
  }
}

/** Every file the format owns under `root`, as relative path → content. */
export async function readManagedFiles(root: string): Promise<FileMap> {
  const limit = limiter(CONCURRENCY);
  const tops = [ROOT_FILE, LOCAL_FILE, LOCAL_GITIGNORE];
  const [contents, collections, environments] = await Promise.all([
    Promise.all(tops.map((rel) => limit(() => readIfThere(join(root, rel))))),
    walk(root, COLLECTIONS_DIR, 0, limit),
    walk(root, ENVIRONMENTS_DIR, 0, limit),
  ]);
  const files: FileMap = new Map();
  for (const [i, rel] of tops.entries()) {
    const content = contents[i];
    if (content !== null) files.set(rel, content); // absent or unreadable: left out
  }
  for (const [rel, content] of [...collections, ...environments]) files.set(rel, content);
  return files;
}

/**
 * Whether each of these files is on disk with exactly this content (null: absent),
 * reading only them. Lets the folder watcher recognise our own writes coming back.
 */
export async function filesMatch(root: string, expected: ReadonlyMap<string, string | null>): Promise<boolean> {
  const limit = limiter(CONCURRENCY);
  const same = await Promise.all(
    [...expected].map(([rel, content]) =>
      limit(() => readTextFile(join(root, rel)).then((s): string | null => s, () => null)).then((s) => s === content),
    ),
  );
  return same.every(Boolean);
}

export interface FolderSecrets {
  /** from the keychain; undefined when there are none or they couldn't be read */
  values?: SecretValues;
  /** why they couldn't be read (the keychain refused, say): saving leaves them alone */
  error?: string;
  /** local.json still holds values in plain text: save once to move them into the keychain */
  migrate: boolean;
}

/** The folder's secret values, from the keychain account named in its local.json. */
export async function readFolderSecrets(files: FileMap): Promise<FolderSecrets> {
  const { id, inline } = localVault(files);
  if (!id) return { migrate: inline };
  try {
    return { values: (await loadSecretValues(folderAccount(id))) ?? undefined, migrate: inline };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), migrate: false };
  }
}

export interface OpenedFolder extends FolderLoad {
  root: string;
  /** The managed files as they are on disk now: the baseline for the next save. */
  files: FileMap;
  secrets: FolderSecrets;
}

export async function openWorkspaceFolder(root: string): Promise<OpenedFolder> {
  const files = await readManagedFiles(root);
  const secrets = await readFolderSecrets(files);
  return { root, files, secrets, ...filesToWorkspace(files, root, secrets.values) };
}

async function removeIfEmpty(path: string) {
  try {
    if ((await readDir(path)).length === 0) await remove(path);
  } catch {
    // gone already, or not empty — either way nothing to do
  }
}

/**
 * Write `workspace` into `root`, touching only files whose content changed.
 * `current` is what was last read or written; returns the new baseline.
 */
export async function saveWorkspaceFolder(
  root: string,
  workspace: Workspace,
  current: FileMap,
  protectedPaths: readonly string[] = [],
): Promise<FileMap> {
  // Secret values go to the keychain (before local.json stops holding them); local.json keeps the account id.
  const id = localVault(current).id ?? crypto.randomUUID();
  const { files, secrets } = detachSecrets(workspaceToFiles(workspace, root), id);
  await saveSecretValues(folderAccount(id), secrets);
  const plan = planWrite(current, files, protectedPaths);
  const limit = limiter(CONCURRENCY);
  const dirs = new Set(plan.writes.map(([rel]) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "")).filter(Boolean));
  for (const dir of dirs) await mkdir(join(root, dir), { recursive: true });
  await Promise.all(plan.writes.map(([rel, content]) => limit(() => writeTextFile(join(root, rel), content))));
  await Promise.all(
    plan.deletes.map((rel) =>
      limit(async () => {
        try {
          await remove(join(root, rel));
        } catch {
          // already gone (e.g. deleted by hand) — the goal is reached
        }
      }),
    ),
  );
  // One at a time, deepest first: a parent is only empty once its children are gone.
  for (const dir of plan.pruneDirs) await removeIfEmpty(join(root, dir));
  return applyPlanToMap(current, plan);
}

/**
 * Turn a workspace (e.g. a legacy single .json file) into a new workspace
 * folder. Refuses a folder that already holds a Satchel workspace.
 */
export async function createWorkspaceFolder(root: string, workspace: Workspace): Promise<FileMap> {
  if (await exists(join(root, ROOT_FILE))) {
    throw new WorkspaceFolderError("That folder already has a Satchel workspace. Open it instead, or pick an empty folder.");
  }
  return saveWorkspaceFolder(root, workspace, new Map());
}
