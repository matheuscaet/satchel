/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseStatus } from "./status";

// The parser against real `git status --porcelain=v2` output (the exact command src-tauri/src/git.rs runs).
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const repo = mkdtempSync(join(tmpdir(), "satchel-status-"));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
const put = (rel: string, content = "{}") => {
  mkdirSync(join(repo, rel, ".."), { recursive: true });
  writeFileSync(join(repo, rel), content);
};
const status = (cwd: string) => git(cwd, "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--", ".");

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe.skipIf(!hasGit)("parseStatus with real git", () => {
  it("reads a workspace inside a subfolder of a repository", () => {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "commit.gpgsign", "false");
    put("src/server.ts", "code");
    put("ws/satchel.json");
    put("ws/collections/shop/auth/login.request.json", '{"a":1}');
    put("ws/collections/shop/old.request.json");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");

    put("src/server.ts", "changed code"); // outside the workspace: must not show up
    put("ws/collections/shop/auth/login.request.json", '{"a":2}');
    unlinkSync(join(repo, "ws/collections/shop/old.request.json"));
    put("ws/collections/shop/my new.request.json");
    git(repo, "mv", "ws/satchel.json", "ws/satchel-renamed.json");

    const prefix = git(join(repo, "ws"), "rev-parse", "--show-prefix").trim();
    const s = parseStatus(status(join(repo, "ws")), prefix);
    expect(s.branch).toBe("main");
    expect(s.upstream).toBeNull();
    expect(s.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(s.changes.map((c) => [c.path, c.kind, c.origPath ?? null])).toEqual([
      ["collections/shop/auth/login.request.json", "modified", null],
      ["collections/shop/my new.request.json", "untracked", null],
      ["collections/shop/old.request.json", "deleted", null],
      ["satchel-renamed.json", "renamed", "satchel.json"],
    ]);
  });
});
