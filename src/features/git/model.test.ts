import { describe, expect, it } from "vitest";
import type { DescribedChange } from "@/git/describe";
import {
  aheadBehind,
  branchLabel,
  canOpen,
  commitLabel,
  errorSummary,
  renamedFrom,
  sectionChanges,
  selectedPaths,
  selectionState,
  splitTitle,
  toggleAll,
  toggleOne,
} from "./model";

const ch = (path: string, over: Partial<DescribedChange> = {}): DescribedChange => ({
  path,
  kind: "modified",
  index: ".",
  worktree: "M",
  group: "requests",
  title: path,
  ...over,
});

const changes = [
  ch("a", { group: "requests" }),
  ch("b", { group: "requests", kind: "conflicted" }),
  ch("c", { group: "environments" }),
  ch("d", { group: "other", kind: "untracked" }),
];

describe("sectionChanges", () => {
  it("groups consecutive changes with their labels", () => {
    const s = sectionChanges(changes);
    expect(s.map((x) => [x.label, x.changes.map((c) => c.path)])).toEqual([
      ["Requests", ["a", "b"]],
      ["Environments", ["c"]],
      ["Other files", ["d"]],
    ]);
  });
  it("is empty for no changes", () => {
    expect(sectionChanges([])).toEqual([]);
  });
});

describe("selection", () => {
  it("selects everything but conflicts by default", () => {
    expect(selectedPaths(changes, new Set())).toEqual(["a", "c", "d"]);
    expect(selectionState(changes, new Set())).toBe("all");
  });
  it("toggles one path", () => {
    const ex = toggleOne(new Set(), "c");
    expect(selectedPaths(changes, ex)).toEqual(["a", "d"]);
    expect(selectionState(changes, ex)).toBe("some");
    expect(selectedPaths(changes, toggleOne(ex, "c"))).toEqual(["a", "c", "d"]);
  });
  it("select all / none", () => {
    const none = toggleAll(changes, new Set());
    expect(selectedPaths(changes, none)).toEqual([]);
    expect(selectionState(changes, none)).toBe("none");
    expect(selectionState(changes, toggleAll(changes, none))).toBe("all");
    // partial → all, and stale paths are forgotten
    expect([...toggleAll(changes, new Set(["a", "gone"]))]).toEqual([]);
  });
  it("new changes start selected", () => {
    const ex = new Set(["a"]);
    expect(selectedPaths([...changes, ch("e")], ex)).toEqual(["c", "d", "e"]);
  });
  it("only conflicts: nothing selectable", () => {
    const only = [ch("x", { kind: "conflicted" })];
    expect(selectionState(only, new Set())).toBe("none");
  });
});

describe("labels", () => {
  it("splits a title into leaf and trail", () => {
    expect(splitTitle("Shop API › Auth › Login")).toEqual({ leaf: "Login", trail: "Shop API › Auth" });
    expect(splitTitle("README.md")).toEqual({ leaf: "README.md", trail: "" });
  });
  it("describes a rename's source", () => {
    expect(renamedFrom(ch("collections/shop/auth/login.request.json"))).toBeNull();
    const from = renamedFrom(ch("x", { kind: "renamed", origPath: "notes.txt" }));
    expect(from).toBe("notes.txt");
    const req = renamedFrom(ch("y", { kind: "renamed", origPath: "collections/shop-api/auth/sign-in.request.json" }));
    expect(req).toBe("shop api › auth › sign in");
  });
  it("opens only live requests and environments", () => {
    expect(canOpen(ch("a", { entityId: "r1" }))).toBe(true);
    expect(canOpen(ch("a", { entityId: "e1", group: "environments" }))).toBe(true);
    expect(canOpen(ch("a", { entityId: "c1", group: "structure" }))).toBe(false);
    expect(canOpen(ch("a"))).toBe(false);
    expect(canOpen(ch("a", { entityId: "r1", kind: "deleted" }))).toBe(false);
  });
  it("commit button label", () => {
    expect(commitLabel(0)).toBe("Commit");
    expect(commitLabel(1)).toBe("Commit 1 file");
    expect(commitLabel(3)).toBe("Commit 3 files");
  });
  it("branch and ahead/behind", () => {
    expect(branchLabel({ branch: "main", commit: "abc1234" })).toBe("main");
    expect(branchLabel({ branch: null, commit: "abc1234" })).toBe("abc1234");
    expect(aheadBehind({ ahead: 2, behind: 1 })).toBe("↑2 ↓1");
    expect(aheadBehind({ ahead: 0, behind: 3 })).toBe("↓3");
    expect(aheadBehind({ ahead: 0, behind: 0 })).toBe("");
  });
  it("summarizes an error", () => {
    expect(errorSummary("fatal: nope\n\nhint: try again\nhint: or not\n")).toEqual({ first: "fatal: nope", rest: "hint: try again\nhint: or not" });
    expect(errorSummary("one line")).toEqual({ first: "one line", rest: "" });
  });
});
