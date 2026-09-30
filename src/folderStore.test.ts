import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "./types";

// An in-memory disk behind the Tauri fs plugin: path → content, directories as a set.
const disk = new Map<string, string>();
const dirs = new Set<string>();
const parent = (p: string) => p.slice(0, p.lastIndexOf("/"));
// Reads in flight, to check the walk runs them concurrently but capped.
const reads = { active: 0, max: 0, count: 0 };

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => disk.has(p) || dirs.has(p),
  readTextFile: async (p: string) => {
    reads.count++;
    reads.max = Math.max(reads.max, ++reads.active);
    await new Promise((r) => setTimeout(r, 1));
    reads.active--;
    if (!disk.has(p)) throw new Error(`ENOENT ${p}`);
    return disk.get(p)!;
  },
  writeTextFile: async (p: string, c: string) => {
    if (!dirs.has(parent(p))) throw new Error(`no dir ${parent(p)}`);
    disk.set(p, c);
  },
  mkdir: async (p: string) => {
    for (let d = p; d.length > 1; d = parent(d)) dirs.add(d);
  },
  remove: async (p: string) => {
    if (!disk.delete(p) && !dirs.delete(p)) throw new Error(`ENOENT ${p}`);
  },
  readDir: async (p: string) => {
    if (!dirs.has(p)) throw new Error(`ENOENT ${p}`);
    const names = new Map<string, boolean>();
    for (const f of disk.keys()) if (parent(f) === p) names.set(f.slice(p.length + 1), false);
    for (const d of dirs) if (parent(d) === p) names.set(d.slice(p.length + 1), true);
    return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }));
  },
}));

const { createWorkspaceFolder, filesMatch, openWorkspaceFolder, readManagedFiles, saveWorkspaceFolder } = await import("./folderStore");
const { readSecret } = await import("./secrets/vault");

const ROOT = "/repo";
const ws = (): Workspace => ({
  collections: [
    {
      id: "c1",
      name: "Shop",
      variables: [],
      items: [
        { type: "folder", id: "f1", name: "Auth", children: [{ type: "request", id: "r1", request: { id: "r1", name: "Login", method: "POST", url: "/login", params: [], pathVariables: {}, headers: [], auth: { type: "none" }, body: { mode: "none" } } }] },
      ],
    },
  ],
  environments: [{ id: "e1", name: "Local", variables: [] }],
  activeEnvironmentId: "e1",
  globals: [],
});

beforeEach(() => {
  disk.clear();
  dirs.clear();
  dirs.add(ROOT);
  Object.assign(reads, { active: 0, max: 0, count: 0 });
});

describe("workspace folders on disk", () => {
  it("creates a folder, then opens it back", async () => {
    await createWorkspaceFolder(ROOT, ws());
    expect(disk.has("/repo/collections/shop/auth/login.request.json")).toBe(true);
    const opened = await openWorkspaceFolder(ROOT);
    expect(opened.problems).toEqual([]);
    expect(opened.workspace).toEqual(ws());
  });

  it("leaves files it doesn't own alone while reading and saving", async () => {
    await createWorkspaceFolder(ROOT, ws());
    disk.set("/repo/README.md", "# team docs");
    dirs.add("/repo/.git");
    disk.set("/repo/.git/config", "[core]");
    const opened = await openWorkspaceFolder(ROOT);
    expect([...opened.files.keys()].some((p) => p.startsWith(".git/") || p === "README.md")).toBe(false);
    await saveWorkspaceFolder(ROOT, { ...ws(), collections: [] }, opened.files);
    expect(disk.get("/repo/README.md")).toBe("# team docs");
    expect(disk.has("/repo/.git/config")).toBe(true);
  });

  it("moves a renamed folder and removes the empty directory it left", async () => {
    const files = await createWorkspaceFolder(ROOT, ws());
    const renamed = ws();
    renamed.collections[0].items[0].type === "folder" && (renamed.collections[0].items[0].name = "Sessions");
    await saveWorkspaceFolder(ROOT, renamed, files);
    expect(disk.has("/repo/collections/shop/sessions/login.request.json")).toBe(true);
    expect(disk.has("/repo/collections/shop/auth/login.request.json")).toBe(false);
    expect(dirs.has("/repo/collections/shop/auth")).toBe(false);
    expect(dirs.has("/repo/collections/shop")).toBe(true);
  });

  it("refuses to create a workspace over an existing one", async () => {
    await createWorkspaceFolder(ROOT, ws());
    await expect(createWorkspaceFolder(ROOT, ws())).rejects.toThrow(/already has a Satchel workspace/);
  });

  it("keeps a conflicted file untouched through a save", async () => {
    await createWorkspaceFolder(ROOT, ws());
    const conflicted = "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n";
    disk.set("/repo/collections/shop/auth/login.request.json", conflicted);
    const opened = await openWorkspaceFolder(ROOT);
    expect(opened.problems).toHaveLength(1);
    await saveWorkspaceFolder(ROOT, opened.workspace, opened.files, opened.protectedPaths);
    expect(disk.get("/repo/collections/shop/auth/login.request.json")).toBe(conflicted);
  });

  it("reads a big folder concurrently, capped, and lists it in a stable order", async () => {
    const big = ws();
    const auth = big.collections[0].items[0];
    if (auth.type !== "folder") throw new Error("fixture");
    const login = auth.children[0];
    if (login.type !== "request") throw new Error("fixture");
    for (let i = 0; i < 60; i++) {
      const id = `r${i + 2}`;
      auth.children.push({ type: "request", id, request: { ...login.request, id, name: `Request ${i}` } });
    }
    await createWorkspaceFolder(ROOT, big);
    Object.assign(reads, { active: 0, max: 0, count: 0 });
    const first = await readManagedFiles(ROOT);
    expect(reads.max).toBeGreaterThan(1);
    expect(reads.max).toBeLessThanOrEqual(16);
    expect([...(await readManagedFiles(ROOT)).keys()]).toEqual([...first.keys()]);
    expect((await openWorkspaceFolder(ROOT)).workspace).toEqual(big);
  });
});

describe("filesMatch", () => {
  it("compares only the given files with the disk (null: must be absent)", async () => {
    const files = await createWorkspaceFolder(ROOT, ws());
    const login = "collections/shop/auth/login.request.json";
    Object.assign(reads, { count: 0 });
    expect(await filesMatch(ROOT, new Map([[login, files.get(login)!]]))).toBe(true);
    expect(reads.count).toBe(1);
    expect(await filesMatch(ROOT, new Map([["collections/shop/gone.request.json", null]]))).toBe(true);

    disk.set(`${ROOT}/${login}`, "{}\n"); // edited outside the app
    expect(await filesMatch(ROOT, new Map([[login, files.get(login)!]]))).toBe(false);
    expect(await filesMatch(ROOT, new Map([[login, null]]))).toBe(false);
    disk.delete(`${ROOT}/${login}`);
    expect(await filesMatch(ROOT, new Map([[login, files.get(login)!]]))).toBe(false);
    expect(await filesMatch(ROOT, new Map([[login, null]]))).toBe(true);
  });
});

describe("secret values", () => {
  const withSecret = (token = "s3cr3t"): Workspace => {
    const w = ws();
    w.environments[0].variables = [
      { key: "token", value: token, enabled: true, secret: true },
      { key: "host", value: "api.test", enabled: true },
    ];
    return w;
  };
  const localJson = () => JSON.parse(disk.get(`${ROOT}/.satchel/local.json`)!);

  it("go to the keychain, not into any file of the folder", async () => {
    await createWorkspaceFolder(ROOT, withSecret());
    for (const content of disk.values()) expect(content).not.toContain("s3cr3t");
    const local = localJson();
    expect(local.vault).toMatch(/^[\w-]+$/);
    expect(local.secrets).toBeUndefined();
    expect(await readSecret(`workspace/${local.vault}`)).toContain("s3cr3t");

    const opened = await openWorkspaceFolder(ROOT);
    expect(opened.secrets).toEqual({ values: expect.anything(), migrate: false });
    expect(opened.workspace).toEqual(withSecret());
  });

  it("keep their keychain account across saves", async () => {
    const files = await createWorkspaceFolder(ROOT, withSecret());
    const { vault } = localJson();
    await saveWorkspaceFolder(ROOT, withSecret("rotated"), files);
    expect(localJson().vault).toBe(vault);
    expect(await readSecret(`workspace/${vault}`)).toContain("rotated");
    expect((await openWorkspaceFolder(ROOT)).workspace).toEqual(withSecret("rotated"));
  });

  it("move out of a local.json written before the keychain", async () => {
    await createWorkspaceFolder(ROOT, withSecret());
    const legacy = { activeEnvironmentId: "e1", secrets: { globals: {}, collections: {}, environments: { e1: { token: "legacy" } } }, files: {} };
    disk.set(`${ROOT}/.satchel/local.json`, JSON.stringify(legacy));

    const opened = await openWorkspaceFolder(ROOT);
    expect(opened.secrets.migrate).toBe(true);
    expect(opened.workspace).toEqual(withSecret("legacy"));

    await saveWorkspaceFolder(ROOT, opened.workspace, opened.files);
    const local = localJson();
    expect(local.secrets).toBeUndefined();
    expect(await readSecret(`workspace/${local.vault}`)).toContain("legacy");
    expect((await openWorkspaceFolder(ROOT)).secrets.migrate).toBe(false);
  });
});

