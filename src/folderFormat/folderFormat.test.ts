import { describe, expect, it } from "vitest";
import type { TreeNode, Workspace } from "@/types";
import { parseWorkspace } from "@/workspace";
import {
  applyPlanToMap,
  detachSecrets,
  filesToWorkspace,
  isManagedPath,
  localVault,
  planWrite,
  relativeInside,
  slugify,
  workspaceFileLabels,
  workspaceToFiles,
  WorkspaceFolderError,
  type FileMap,
} from ".";
import { nameAllocator } from "./slug";

const ROOT = "/home/dev/shop-api";

function sample(): Workspace {
  return {
    collections: [
      {
        id: "c-shop",
        name: "Shop API",
        variables: [
          { key: "baseUrl", value: "http://localhost:8080", enabled: true },
          { key: "apiKey", value: "sk_live_123", enabled: true, secret: true },
        ],
        items: [
          {
            type: "folder",
            id: "f-auth",
            name: "Auth",
            children: [
              {
                type: "request",
                id: "r-login",
                request: {
                  id: "r-login",
                  name: "Login",
                  method: "POST",
                  url: "{{baseUrl}}/login",
                  params: [],
                  pathVariables: {},
                  headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
                  auth: { type: "none" },
                  body: { mode: "raw", language: "json", raw: '{\n  "user": "dev"\n}' },
                },
              },
            ],
          },
          {
            type: "request",
            id: "r-list",
            request: {
              id: "r-list",
              name: "List products",
              method: "GET",
              url: "{{baseUrl}}/products/:category?limit=20",
              params: [
                { key: "limit", value: "20", enabled: true },
                { key: "sort", value: "name", enabled: false },
              ],
              pathVariables: { category: "bags" },
              headers: [],
              auth: { type: "bearer", token: "{{token}}" },
              body: { mode: "none" },
            },
          },
          {
            type: "request",
            id: "r-list-2",
            request: {
              id: "r-list-2",
              name: "List products",
              method: "QUERY",
              url: "{{baseUrl}}/products",
              params: [],
              pathVariables: {},
              headers: [],
              auth: { type: "apikey", key: "X-Key", value: "{{apiKey}}", in: "header" },
              body: {
                mode: "formdata",
                fields: [
                  { key: "note", value: "hi", enabled: true, type: "text" },
                  { key: "fixture", value: "", enabled: true, type: "file", fileName: "avatar.png", filePath: `${ROOT}/fixtures/avatar.png` },
                  { key: "upload", value: "", enabled: false, type: "file", fileName: "big.bin", filePath: "/tmp/big.bin" },
                ],
              },
            },
          },
        ],
      },
      { id: "c-pay", name: "Payments", variables: [], items: [] },
    ],
    environments: [
      { id: "e-local", name: "Local", color: "var(--ok)", variables: [{ key: "token", value: "dev-token", enabled: true, secret: true }] },
      { id: "e-prod", name: "Production", variables: [{ key: "baseUrl", value: "https://api.shop.dev", enabled: true }] },
    ],
    activeEnvironmentId: "e-prod",
    globals: [{ key: "userAgent", value: "satchel", enabled: true }],
  };
}

const shared = (files: FileMap) => [...files].filter(([p]) => !p.startsWith(".satchel/"));

describe("workspaceToFiles", () => {
  it("lays out one file per request, folders as directories, environments as files", () => {
    expect([...workspaceToFiles(sample(), ROOT).keys()].sort()).toEqual([
      ".satchel/.gitignore",
      ".satchel/local.json",
      "collections/payments/collection.json",
      "collections/shop-api/auth/folder.json",
      "collections/shop-api/auth/login.request.json",
      "collections/shop-api/collection.json",
      "collections/shop-api/list-products-2.request.json",
      "collections/shop-api/list-products.request.json",
      "environments/local.json",
      "environments/production.json",
      "satchel.json",
    ]);
  });

  it("keeps secrets, the active environment and machine paths out of shared files", () => {
    const files = workspaceToFiles(sample(), ROOT);
    const sharedText = shared(files).map(([, c]) => c).join("\n");
    expect(sharedText).not.toContain("sk_live_123");
    expect(sharedText).not.toContain("dev-token");
    expect(sharedText).not.toContain("/tmp/big.bin");
    expect(sharedText).not.toContain("e-prod\"\n}"); // no activeEnvironmentId outside local.json
    expect(sharedText).not.toContain("activeEnvironmentId");
    const local = JSON.parse(files.get(".satchel/local.json")!);
    expect(local.activeEnvironmentId).toBe("e-prod");
    expect(local.secrets.collections["c-shop"]).toEqual({ apiKey: "sk_live_123" });
    expect(local.secrets.environments["e-local"]).toEqual({ token: "dev-token" });
    expect(local.files["r-list-2"]).toEqual({ "2": "/tmp/big.bin" });
  });

  it("stores form-data files inside the workspace as portable relative paths", () => {
    const req = JSON.parse(workspaceToFiles(sample(), ROOT).get("collections/shop-api/list-products-2.request.json")!);
    expect(req.body.fields[1]).toEqual({ key: "fixture", type: "file", value: "", enabled: true, fileName: "avatar.png", path: "fixtures/avatar.png" });
    expect(req.body.fields[2]).toEqual({ key: "upload", type: "file", value: "", enabled: false, fileName: "big.bin" });
  });

  it("is deterministic, with a fixed key order and a trailing newline", () => {
    const a = workspaceToFiles(sample(), ROOT);
    const b = workspaceToFiles(structuredClone(sample()), ROOT);
    expect([...a]).toEqual([...b]);
    const login = a.get("collections/shop-api/auth/login.request.json")!;
    expect(Object.keys(JSON.parse(login))).toEqual(["id", "name", "method", "url", "params", "headers", "auth", "body"]);
    expect(login.endsWith("}\n")).toBe(true);
    expect(JSON.parse(a.get("collections/shop-api/collection.json")!).order).toEqual([
      "auth",
      "list-products.request.json",
      "list-products-2.request.json",
    ]);
  });

  it("ignores the whole .satchel directory from git on its own", () => {
    expect(workspaceToFiles(sample()).get(".satchel/.gitignore")).toMatch(/^\*$/m);
  });
});

describe("filesToWorkspace", () => {
  it("round-trips the workspace, secrets and file paths included", () => {
    const { workspace, problems, protectedPaths } = filesToWorkspace(workspaceToFiles(sample(), ROOT), ROOT);
    expect(problems).toEqual([]);
    expect(protectedPaths).toEqual([]);
    expect(workspace).toEqual(sample());
  });

  it("detaches secrets for the keychain and takes them back from it, over any left in local.json", () => {
    const { files, secrets } = detachSecrets(workspaceToFiles(sample(), ROOT), "vault-1");
    expect(localVault(files)).toEqual({ id: "vault-1", inline: false });
    expect(secrets.environments["e-local"]).toEqual({ token: "dev-token" });
    expect(filesToWorkspace(files, ROOT, secrets).workspace).toEqual(sample());

    // an older local.json still holding a value: the keychain's wins, and the file is flagged for migration
    const legacy = workspaceToFiles(sample(), ROOT);
    expect(localVault(legacy)).toEqual({ id: null, inline: true });
    const fromKeychain = { ...secrets, environments: { "e-local": { token: "rotated" } } };
    const env = filesToWorkspace(legacy, ROOT, fromKeychain).workspace.environments.find((e) => e.id === "e-local")!;
    expect(env.variables.find((v) => v.key === "token")?.value).toBe("rotated");
  });

  it("converts a legacy single-file workspace", () => {
    const legacy = parseWorkspace(JSON.parse(JSON.stringify(sample())));
    const back = filesToWorkspace(workspaceToFiles(legacy, ROOT), ROOT).workspace;
    expect(back).toEqual(legacy);
  });

  it("follows `order`, then adds files it doesn't list, and skips listed files that are gone", () => {
    const files = workspaceToFiles(sample(), ROOT);
    const col = JSON.parse(files.get("collections/shop-api/collection.json")!);
    col.order = ["gone.request.json", "list-products-2.request.json", "auth"];
    files.set("collections/shop-api/collection.json", JSON.stringify(col));
    files.set("collections/shop-api/added.request.json", JSON.stringify({ id: "r-new", name: "Added", method: "GET", url: "/x" }));
    const items = filesToWorkspace(files, ROOT).workspace.collections[0].items;
    expect(items.map((n) => (n.type === "folder" ? n.name : n.request.name))).toEqual(["List products", "Auth", "Added", "List products"]);
  });

  it("gives a file without an id a stable one from its path", () => {
    const files = workspaceToFiles(sample(), ROOT);
    files.set("collections/payments/charge.request.json", JSON.stringify({ name: "Charge", method: "post", url: "/charge" }));
    const a = filesToWorkspace(files, ROOT).workspace.collections[1].items[0];
    const b = filesToWorkspace(files, ROOT).workspace.collections[1].items[0];
    expect(a.id).toBe("path:collections/payments/charge.request.json");
    expect(a.id).toBe(b.id);
    expect(a.type === "request" && a.request.method).toBe("POST");
  });

  it("warns and re-ids a copied file instead of creating duplicate ids", () => {
    const files = workspaceToFiles(sample(), ROOT);
    files.set("collections/payments/copy.request.json", files.get("collections/shop-api/auth/login.request.json")!);
    const { workspace, problems } = filesToWorkspace(files, ROOT);
    expect(workspace.collections[1].items[0].id).toBe("path:collections/payments/copy.request.json");
    expect(problems).toEqual([expect.objectContaining({ path: "collections/payments/copy.request.json", severity: "warning" })]);
  });

  it("skips and protects a request with merge conflict markers, loading the rest", () => {
    const files = workspaceToFiles(sample(), ROOT);
    const path = "collections/shop-api/list-products.request.json";
    files.set(path, `<<<<<<< HEAD\n${files.get(path)}=======\n{}\n>>>>>>> origin/main\n`);
    const { workspace, problems, protectedPaths } = filesToWorkspace(files, ROOT);
    expect(problems).toEqual([{ path, message: expect.stringContaining("merge conflict"), severity: "error" }]);
    expect(protectedPaths).toEqual([path]);
    expect(workspace.collections[0].items).toHaveLength(2);
  });

  it("protects a whole folder whose folder.json is broken", () => {
    const files = workspaceToFiles(sample(), ROOT);
    files.set("collections/shop-api/auth/folder.json", "{ nope");
    const { workspace, protectedPaths, problems } = filesToWorkspace(files, ROOT);
    expect(protectedPaths).toEqual(["collections/shop-api/auth/"]);
    expect(problems[0].message).toMatch(/valid JSON/);
    expect(workspace.collections[0].items.map((n) => n.id)).toEqual(["r-list", "r-list-2"]);
  });

  it("rejects invalid request shapes with a readable message", () => {
    const files = workspaceToFiles(sample(), ROOT);
    files.set("collections/payments/bad.request.json", JSON.stringify({ name: "Bad", method: "FETCH", url: "/" }));
    expect(filesToWorkspace(files, ROOT).problems[0].message).toBe('unknown method "FETCH"');
  });

  it("resets personal state when local.json is broken, with a warning", () => {
    const files = workspaceToFiles(sample(), ROOT);
    files.set(".satchel/local.json", "not json");
    const { workspace, problems } = filesToWorkspace(files, ROOT);
    expect(workspace.activeEnvironmentId).toBeNull();
    expect(workspace.environments[0].variables[0]).toEqual({ key: "token", value: "", enabled: true, secret: true });
    expect(problems[0]).toMatchObject({ path: ".satchel/local.json", severity: "warning" });
  });

  it("opens a workspace cloned without local.json (a teammate's first checkout)", () => {
    const files = workspaceToFiles(sample(), ROOT);
    files.delete(".satchel/local.json");
    const { workspace, problems } = filesToWorkspace(files, ROOT);
    expect(problems).toEqual([]);
    expect(workspace.activeEnvironmentId).toBeNull();
    expect(workspace.collections[0].variables[1].value).toBe("");
  });

  it("refuses folders that aren't workspaces, or come from a newer format", () => {
    expect(() => filesToWorkspace(new Map())).toThrow(WorkspaceFolderError);
    expect(() => filesToWorkspace(new Map([["satchel.json", '{"format":"other"}']]))).toThrow(/isn't a Satchel workspace/);
    expect(() => filesToWorkspace(new Map([["satchel.json", '{"format":"satchel-workspace","version":99}']]))).toThrow(/newer Satchel/);
  });
});

describe("planWrite", () => {
  it("does nothing when nothing changed", () => {
    const files = workspaceToFiles(sample(), ROOT);
    expect(planWrite(files, workspaceToFiles(sample(), ROOT))).toEqual({ writes: [], deletes: [], pruneDirs: [] });
  });

  it("writes only the changed request", () => {
    const before = workspaceToFiles(sample(), ROOT);
    const ws = sample();
    const login = ws.collections[0].items[0];
    if (login.type === "folder" && login.children[0].type === "request") login.children[0].request.url = "{{baseUrl}}/v2/login";
    const plan = planWrite(before, workspaceToFiles(ws, ROOT));
    expect(plan.writes.map(([p]) => p)).toEqual(["collections/shop-api/auth/login.request.json"]);
    expect(plan.deletes).toEqual([]);
  });

  it("renames by writing the new file, deleting the old one and pruning empty folders", () => {
    const before = workspaceToFiles(sample(), ROOT);
    const ws = sample();
    ws.collections[0].items[0].type === "folder" && (ws.collections[0].items[0].name = "Authentication");
    const plan = planWrite(before, workspaceToFiles(ws, ROOT));
    expect(plan.writes.map(([p]) => p)).toEqual([
      "collections/shop-api/authentication/folder.json",
      "collections/shop-api/authentication/login.request.json",
      "collections/shop-api/collection.json",
    ]);
    expect(plan.deletes).toEqual(["collections/shop-api/auth/folder.json", "collections/shop-api/auth/login.request.json"]);
    expect(plan.pruneDirs).toEqual(["collections/shop-api/auth", "collections/shop-api"]);
    expect([...applyPlanToMap(before, plan).keys()]).toContain("collections/shop-api/authentication/login.request.json");
  });

  it("never deletes files the format doesn't own, nor protected ones", () => {
    const before = workspaceToFiles(sample(), ROOT);
    before.set("README.md", "# docs");
    before.set("collections/shop-api/notes.txt", "keep me");
    const empty = workspaceToFiles({ collections: [], environments: [], activeEnvironmentId: null, globals: [] }, ROOT);
    const plan = planWrite(before, empty, ["collections/shop-api/auth/", "environments/local.json"]);
    expect(plan.deletes).not.toContain("README.md");
    expect(plan.deletes).not.toContain("collections/shop-api/notes.txt");
    expect(plan.deletes).not.toContain("collections/shop-api/auth/login.request.json");
    expect(plan.deletes).not.toContain("environments/local.json");
    expect(plan.deletes).toContain("environments/production.json");
  });
});

describe("names and paths", () => {
  it("slugifies display names", () => {
    expect(slugify("Configurações de Usuário")).toBe("configuracoes-de-usuario");
    expect(slugify("  GET /users/:id  ")).toBe("get-users-id");
    expect(slugify("🚀")).toBe("untitled");
    expect(slugify("a".repeat(100))).toHaveLength(60);
  });

  it("allocates unique, case-insensitive names and skips reserved ones", () => {
    const alloc = nameAllocator(["folder.json"]);
    expect(alloc("login", ".request.json")).toBe("login.request.json");
    expect(alloc("Login", ".request.json")).toBe("Login-2.request.json");
    expect(alloc("folder", ".json")).toBe("folder-2.json");
  });

  it("labels exactly the paths a full write produces, name collisions included", () => {
    const ws = sample();
    const col = ws.collections[0];
    const req = (col.items[1] as Extract<TreeNode, { type: "request" }>).request;
    // A folder named like a request, one named like the reserved folder file, and a nested collision.
    col.items.push(
      { type: "folder", id: "f-list", name: "List products", children: [] },
      { type: "folder", id: "f-folder", name: "Folder", children: [{ type: "request", id: "r-x", request: { ...req, id: "r-x", name: "Folder" } }] },
      { type: "folder", id: "f-auth-2", name: "auth", children: [{ type: "request", id: "r-login-2", request: { ...req, id: "r-login-2", name: "Login" } }] },
    );
    // Collections and environments with the same slug.
    ws.collections.push({ id: "c-shop-2", name: "Shop  API!", variables: [], items: [] }, { id: "c-emoji", name: "🚀", variables: [], items: [] });
    ws.environments.push({ id: "e-local-2", name: "local", variables: [] });

    const labels = workspaceFileLabels(ws);
    const files = [...workspaceToFiles(ws, ROOT).keys()].filter((p) => !p.startsWith(".satchel/"));
    expect([...labels.keys()].sort()).toEqual(files.sort());
    expect(labels.get("collections/shop-api-2/collection.json")).toMatchObject({ kind: "collection", id: "c-shop-2" });
    expect(labels.get("environments/local-2.json")).toMatchObject({ kind: "environment", id: "e-local-2" });
  });

  it("recognizes managed paths", () => {
    expect(isManagedPath("collections/a/b/x.request.json")).toBe(true);
    expect(isManagedPath("collections/a/README.md")).toBe(false);
    expect(isManagedPath("environments/dev.json")).toBe(true);
    expect(isManagedPath("environments/nested/dev.json")).toBe(false);
    expect(isManagedPath(".satchel/local.json")).toBe(true);
    expect(isManagedPath("package.json")).toBe(false);
  });

  it("finds paths inside the workspace, including Windows ones", () => {
    expect(relativeInside("/home/dev/ws", "/home/dev/ws/fixtures/a.png")).toBe("fixtures/a.png");
    expect(relativeInside("C:\\dev\\ws\\", "C:\\dev\\ws\\fixtures\\a.png")).toBe("fixtures/a.png");
    expect(relativeInside("/home/dev/ws", "/home/dev/ws-other/a.png")).toBeNull();
    expect(relativeInside("/home/dev/ws", "/home/dev/ws/../etc/passwd")).toBeNull();
  });
});
