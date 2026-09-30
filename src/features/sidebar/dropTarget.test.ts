import { describe, expect, it } from "vitest";
import type { Collection, TreeNode } from "@/types";
import { resolveDrop, zoneFor } from "./dropTarget";
import { visibleRows } from "./treeRows";

const req = (id: string): TreeNode => ({
  type: "request",
  id,
  request: { id, name: id, method: "GET", url: "", params: [], headers: [], auth: { type: "none" }, body: { mode: "none" } },
});
const folder = (id: string, children: TreeNode[]): TreeNode => ({ type: "folder", id, name: id, children });
const col = (id: string, items: TreeNode[]): Collection => ({ id, name: id, variables: [], items });

// A            (row 0)
//   r1         (row 1)
//   F1         (row 2)
//     r2       (row 3)
//     F2       (row 4)
//       r3     (row 5)
// B            (row 6)
//   r4         (row 7)
const cols = [col("A", [req("r1"), folder("F1", [req("r2"), folder("F2", [req("r3")])])]), col("B", [req("r4")])];
const rows = visibleRows(cols, "", new Set());
const at = (id: string) => rows.findIndex((r) => r.id === id);

describe("zoneFor", () => {
  it("splits requests in halves and containers in before / inside / after bands", () => {
    expect(zoneFor("request", 0.4)).toBe("before");
    expect(zoneFor("request", 0.6)).toBe("after");
    expect(zoneFor("folder", 0.1)).toBe("before");
    expect(zoneFor("folder", 0.5)).toBe("inside");
    expect(zoneFor("collection", 0.9)).toBe("after");
  });
});

describe("resolveDrop", () => {
  it("drops a request before another one in a different folder", () => {
    const drop = resolveDrop(cols, rows, { id: "r1", kind: "request" }, at("r3"), 0.2, 9);
    expect(drop).toMatchObject({ kind: "node", target: { collectionId: "A", parentFolderId: "F2", index: 0 } });
    expect(drop?.indicator).toEqual({ type: "line", rowId: "r3", edge: "top", depth: 3 });
  });

  it("drops inside a folder (appended) and inside a collection", () => {
    expect(resolveDrop(cols, rows, { id: "r4", kind: "request" }, at("F1"), 0.5, 0)).toMatchObject({
      target: { collectionId: "A", parentFolderId: "F1", index: 2 },
      indicator: { type: "inside", rowId: "F1" },
    });
    expect(resolveDrop(cols, rows, { id: "r1", kind: "request" }, at("B"), 0.5, 0)).toMatchObject({
      target: { collectionId: "B", parentFolderId: null, index: 1 },
    });
  });

  it("uses the pointer's depth to drop after the last child or after its folder(s)", () => {
    const deep = resolveDrop(cols, rows, { id: "r4", kind: "request" }, at("r3"), 0.9, 9);
    expect(deep).toMatchObject({ target: { parentFolderId: "F2", index: 1 }, indicator: { depth: 3 } });
    const afterF2 = resolveDrop(cols, rows, { id: "r4", kind: "request" }, at("r3"), 0.9, 2);
    expect(afterF2).toMatchObject({ target: { parentFolderId: "F1", index: 2 }, indicator: { depth: 2 } });
    const afterF1 = resolveDrop(cols, rows, { id: "r4", kind: "request" }, at("r3"), 0.9, 0);
    expect(afterF1).toMatchObject({ target: { collectionId: "A", parentFolderId: null, index: 2 }, indicator: { depth: 1 } });
  });

  it("refuses requests at the root level, between collections", () => {
    expect(resolveDrop(cols, rows, { id: "r1", kind: "request" }, at("B"), 0.1, 0)).toBeNull();
  });

  it("refuses a folder into itself or its subtree", () => {
    expect(resolveDrop(cols, rows, { id: "F1", kind: "folder" }, at("F2"), 0.5, 0)).toBeNull();
    expect(resolveDrop(cols, rows, { id: "F1", kind: "folder" }, at("r2"), 0.2, 0)).toBeNull();
  });

  it("refuses no-op drops", () => {
    expect(resolveDrop(cols, rows, { id: "r2", kind: "request" }, at("r2"), 0.2, 2)).toBeNull();
    expect(resolveDrop(cols, rows, { id: "r2", kind: "request" }, at("F2"), 0.1, 2)).toBeNull();
  });

  it("moves collections only before/after other collections, by halves of their block", () => {
    const before = resolveDrop(cols, rows, { id: "B", kind: "collection" }, at("r1"), 0.5, 0);
    expect(before).toEqual({ kind: "collection", toIndex: 0, indicator: { type: "line", rowId: "A", edge: "top", depth: 0 } });
    // The lower half of A's block is "after A" — B's own place, so nothing to do.
    expect(resolveDrop(cols, rows, { id: "B", kind: "collection" }, at("r3"), 0.5, 0)).toBeNull();
    const after = resolveDrop(cols, rows, { id: "A", kind: "collection" }, at("r4"), 0.9, 0);
    expect(after).toEqual({ kind: "collection", toIndex: 2, indicator: { type: "line", rowId: "r4", edge: "bottom", depth: 0 } });
  });
});
