import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/platform";

/** Thin wrappers over the Rust git commands (src-tauri/src/git.rs). Each rejects with git's own message. */

export interface GitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitInfo {
  isRepo: boolean;
  /** the workspace folder relative to the repository root, with a trailing "/" ("" at the root) */
  prefix: string;
  /** a merge or rebase in progress (e.g. after a pull that conflicted) */
  operation: "merge" | "rebase" | null;
}

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject("Git needs the desktop app — run with `npm run tauri dev`.");
  return invoke<T>(cmd, args);
}

export const gitVersion = () => call<string>("git_version");
export const gitInfo = (cwd: string) => call<GitInfo>("git_info", { cwd });
/** Only needed for the first push of a branch, so it isn't part of `gitInfo`. */
export const gitRemotes = (cwd: string) => call<string[]>("git_remotes", { cwd });
export const gitStatus = (cwd: string) => call<string>("git_status", { cwd });
export const gitCommit = (cwd: string, message: string, paths: string[]) => call<GitOutput>("git_commit", { cwd, message, paths });
/** Finish a merge: stage the folder's resolutions and commit everything (refuses while conflict markers remain). */
export const gitCommitMerge = (cwd: string, message?: string) => call<GitOutput>("git_commit_merge", { cwd, message: message ?? null });
export const gitFetch = (cwd: string) => call<GitOutput>("git_fetch", { cwd });
export const gitPull = (cwd: string) => call<GitOutput>("git_pull", { cwd });
/** `setUpstream`: remote name for the first push of a new branch */
export const gitPush = (cwd: string, setUpstream?: string) => call<GitOutput>("git_push", { cwd, setUpstream: setUpstream ?? null });
export const gitInit = (cwd: string) => call<GitOutput>("git_init", { cwd });
