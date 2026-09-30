import { describe, expect, it } from "vitest";
import type { Collection, TreeNode } from "@/types";
import { keepUnchangedRows, sameRow, visibleRows } from "./treeRows";

const req = (id: string, url = ""): TreeNode => ({
  type: "request",
  id,
  request: { id, name: id, method: "GET", url, params: [], headers: [], auth: { type: "none" }, body: { mode: "none" } },
});
const folder = (id: string, children: TreeNode[]): TreeNode => ({ type: "folder", id, name: id, children });
const col = (id: string, items: TreeNode[]): Collection => ({ id, name: id, variables: [], items });

const cols = [col("A", [req("r1"), folder("F1", [req("r2"), req("r3")]), req("r4")]), col("B", [req("r5")])];

describe("visibleRows sibling positions", () => {
  it("numbers each row among its visible siblings", () => {
    const rows = visibleRows(cols, "", new Set());
    const pos = Object.fromEntries(rows.map((r) => [r.id, [r.posInSet, r.setSize]]));
    expect(pos).toEqual({ A: [1, 2], r1: [1, 3], F1: [2, 3], r2: [1, 2], r3: [2, 2], r4: [3, 3], B: [2, 2], r5: [1, 1] });
  });

  it("counts only the siblings the filter keeps", () => {
    const rows = visibleRows(cols, "r3", new Set());
    expect(rows.map((r) => [r.id, r.posInSet, r.setSize])).toEqual([
      ["A", 1, 1],
      ["F1", 1, 1],
      ["r3", 1, 1],
    ]);
  });
});

describe("keepUnchangedRows", () => {
  it("returns the previous array when nothing changed", () => {
    const prev = visibleRows(cols, "", new Set());
    expect(keepUnchangedRows(prev, visibleRows(cols, "", new Set()))).toBe(prev);
  });

  it("keeps the objects of unchanged rows and takes the changed ones", () => {
    const prev = visibleRows(cols, "", new Set());
    // A request edit replaces that request (and its ancestors) but shares everything else.
    const edited = req("r2", "https://x");
    const f1 = folder("F1", [edited, (cols[0].items[1] as Extract<TreeNode, { type: "folder" }>).children[1]]);
    const next = [col("A", [cols[0].items[0], f1, cols[0].items[2]]), cols[1]];
    const rows = keepUnchangedRows(prev, visibleRows(next, "", new Set()));
    expect(rows).not.toBe(prev);
    const changed = rows.filter((r, i) => r !== prev[i]).map((r) => r.id);
    expect(changed).toEqual(["r2"]);
  });

  it("takes new rows when one opens or closes", () => {
    const prev = visibleRows(cols, "", new Set());
    const rows = keepUnchangedRows(prev, visibleRows(cols, "", new Set(["F1"])));
    expect(rows.map((r) => r.id)).toEqual(["A", "r1", "F1", "r4", "B", "r5"]);
    expect(rows.find((r) => r.id === "F1")).not.toBe(prev.find((r) => r.id === "F1"));
    expect(rows.find((r) => r.id === "r4")).toBe(prev.find((r) => r.id === "r4"));
  });
});

describe("sameRow", () => {
  it("compares field by field, the request by identity", () => {
    const [a] = visibleRows(cols, "", new Set());
    expect(sameRow(a, { ...a })).toBe(true);
    expect(sameRow(a, { ...a, name: "other" } as typeof a)).toBe(false);
    const r = visibleRows(cols, "", new Set()).find((row) => row.kind === "request")!;
    expect(sameRow(r, { ...r })).toBe(true);
    if (r.kind === "request") expect(sameRow(r, { ...r, request: { ...r.request } })).toBe(false);
  });
});
