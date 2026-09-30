import { describe, expect, it } from "vitest";
import { commitPaths, parseStatus } from "./status";

const z = (...lines: string[]) => lines.join("\0") + "\0";

describe("parseStatus", () => {
  it("reads branch, upstream and ahead/behind", () => {
    const s = parseStatus(z("# branch.oid 1a2b3c4d5e6f", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -3"));
    expect(s).toEqual({ branch: "main", commit: "1a2b3c4", upstream: "origin/main", ahead: 2, behind: 3, changes: [] });
  });

  it("handles a detached HEAD and a repository without commits", () => {
    expect(parseStatus(z("# branch.oid (initial)", "# branch.head (detached)"))).toMatchObject({ branch: null, commit: null, upstream: null });
  });

  it("classifies changed, added, deleted, untracked and conflicted files, with spaces in names", () => {
    const s = parseStatus(
      z(
        "# branch.head feat/x",
        "1 .M N... 100644 100644 100644 aaa bbb collections/shop/auth/login.request.json",
        "1 A. N... 000000 100644 100644 000 ccc environments/qa.json",
        "1 D. N... 100644 000000 000000 ddd 000 collections/shop/old.request.json",
        "? collections/shop/my request.request.json",
        "u UU N... 100644 100644 100644 100644 e1 e2 e3 satchel.json",
      ),
    );
    expect(s.changes.map((c) => [c.path, c.kind, c.index + c.worktree])).toEqual([
      ["collections/shop/auth/login.request.json", "modified", ".M"],
      ["collections/shop/my request.request.json", "untracked", "??"],
      ["collections/shop/old.request.json", "deleted", "D."],
      ["environments/qa.json", "added", "A."],
      ["satchel.json", "conflicted", "UU"],
    ]);
  });

  it("reads renames with their original path", () => {
    const s = parseStatus(z("2 R. N... 100644 100644 100644 aaa aaa R100 collections/shop/sessions/login.request.json", "collections/shop/auth/login.request.json"));
    expect(s.changes).toEqual([
      {
        path: "collections/shop/sessions/login.request.json",
        origPath: "collections/shop/auth/login.request.json",
        kind: "renamed",
        index: "R",
        worktree: ".",
      },
    ]);
  });

  it("keeps only changes inside the workspace when it's a subfolder of the repository", () => {
    const s = parseStatus(z("1 .M N... 100644 100644 100644 a b src/server.ts", "1 .M N... 100644 100644 100644 a b api/satchel/satchel.json"), "api/satchel/");
    expect(s.changes.map((c) => c.path)).toEqual(["satchel.json"]);
  });
});

describe("commitPaths", () => {
  it("includes both sides of a rename", () => {
    expect(
      commitPaths([
        { path: "b.json", origPath: "a.json", kind: "renamed", index: "R", worktree: "." },
        { path: "c.json", kind: "modified", index: ".", worktree: "M" },
      ]),
    ).toEqual(["b.json", "a.json", "c.json"]);
  });
});
