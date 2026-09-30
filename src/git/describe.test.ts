import { describe, expect, it } from "vitest";
import { workspaceFileLabels } from "@/folderFormat";
import type { Workspace } from "@/types";
import { describeChanges } from "./describe";
import type { GitChange } from "./status";

const ws: Workspace = {
  collections: [
    {
      id: "c1",
      name: "Shop API",
      variables: [],
      items: [
        {
          type: "folder",
          id: "f1",
          name: "Auth",
          children: [{ type: "request", id: "r1", request: { id: "r1", name: "Login", method: "POST", url: "/", params: [], headers: [], auth: { type: "none" }, body: { mode: "none" } } }],
        },
      ],
    },
  ],
  environments: [{ id: "e1", name: "QA", variables: [] }],
  activeEnvironmentId: null,
  globals: [],
};

const change = (path: string, kind: GitChange["kind"] = "modified"): GitChange => ({ path, kind, index: ".", worktree: "M" });

describe("describeChanges", () => {
  it("names files after what they hold, grouped", () => {
    const out = describeChanges(
      [
        change("README.md"),
        change("satchel.json"),
        change("environments/qa.json", "added"),
        change("collections/shop-api/auth/folder.json"),
        change("collections/shop-api/auth/login.request.json"),
      ],
      workspaceFileLabels(ws),
    );
    expect(out.map((c) => [c.group, c.title, c.method ?? null, c.entityId ?? null])).toEqual([
      ["requests", "Shop API › Auth › Login", "POST", "r1"],
      ["structure", "Shop API › Auth", null, "f1"],
      ["environments", "QA", null, "e1"],
      ["workspace", "Workspace settings", null, null],
      ["other", "README.md", null, null],
    ]);
  });

  it("gives deleted files (no longer in the workspace) a readable name from their path", () => {
    const [c] = describeChanges([change("collections/shop-api/products/list-products-2.request.json", "deleted")], workspaceFileLabels(ws));
    expect(c).toMatchObject({ group: "requests", title: "shop api › products › list products 2", kind: "deleted" });
    expect(c.entityId).toBeUndefined();
  });
});
