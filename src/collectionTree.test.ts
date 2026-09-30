import { describe, expect, it } from "vitest";
import {
  addNode,
  countRequests,
  indexRequests,
  locateNode,
  moveCollection,
  moveNode,
  removeNode,
  renameNode,
  resolveVariables,
  siblingStep,
  updateRequestInCollections,
} from "./collectionTree";
import type { Collection, TreeNode } from "./types";

describe("resolveVariables", () => {
  it("substitutes a simple {{variable}}", () => {
    expect(resolveVariables("{{baseUrl}}/items", [{ key: "baseUrl", value: "https://api.test", enabled: true }])).toBe(
      "https://api.test/items",
    );
  });

  it("substitutes hyphenated and dotted variable names (regression: these look like real Postman exports, e.g. {{dotnetapi-local}})", () => {
    const vars = [{ key: "dotnetapi-local", value: "http://localhost:5000", enabled: true }];
    expect(resolveVariables("{{dotnetapi-local}}/items", vars)).toBe("http://localhost:5000/items");

    const dotted = [{ key: "api.host", value: "example.com", enabled: true }];
    expect(resolveVariables("https://{{api.host}}/x", dotted)).toBe("https://example.com/x");
  });

  it("leaves an unknown placeholder untouched instead of dropping it", () => {
    expect(resolveVariables("{{unknown}}/items", [])).toBe("{{unknown}}/items");
  });

  it("does not substitute a variable whose enabled flag is false", () => {
    const vars = [{ key: "token", value: "secret", enabled: false }];
    expect(resolveVariables("Bearer {{token}}", vars)).toBe("Bearer {{token}}");
  });

  it("first match wins, so callers encode precedence via array order (env before collection before globals)", () => {
    const vars = [
      { key: "host", value: "from-env", enabled: true },
      { key: "host", value: "from-collection", enabled: true },
      { key: "host", value: "from-globals", enabled: true },
    ];
    expect(resolveVariables("{{host}}", vars)).toBe("from-env");
  });
});

function requestNode(id: string): TreeNode {
  return {
    type: "request",
    id,
    request: { id, name: id, method: "GET", url: "", params: [], headers: [], auth: { type: "none" }, body: { mode: "none" } },
  };
}

describe("countRequests", () => {
  it("counts requests at the top level and nested inside folders", () => {
    const tree: TreeNode[] = [
      requestNode("a"),
      { type: "folder", id: "f1", name: "Folder", children: [requestNode("b"), requestNode("c")] },
      { type: "folder", id: "f2", name: "Nested", children: [{ type: "folder", id: "f3", name: "Deeper", children: [requestNode("d")] }] },
    ];
    expect(countRequests(tree)).toBe(4);
  });

  it("is 0 for an empty tree or a tree of only empty folders", () => {
    expect(countRequests([])).toBe(0);
    expect(countRequests([{ type: "folder", id: "f", name: "Empty", children: [] }])).toBe(0);
  });
});

// ---- moving nodes ---------------------------------------------------------------------------

function folder(id: string, children: TreeNode[]): TreeNode {
  return { type: "folder", id, name: id, children };
}

function collection(id: string, items: TreeNode[]): Collection {
  return { id, name: id, variables: [], items };
}

/** Compact shape of a tree: ids, with folders as [id, children]. */
type Shape = string | [string, Shape[]];
function shape(items: TreeNode[]): Shape[] {
  return items.map((n) => (n.type === "request" ? n.id : [n.id, shape(n.children)]));
}
function shapes(cols: Collection[]): Record<string, Shape[]> {
  return Object.fromEntries(cols.map((c) => [c.id, shape(c.items)]));
}

// A: r1, r2, r3, F1[ r4, F2[ r5 ] ]      B: r6, F3[]
function fixture(): Collection[] {
  return [
    collection("A", [
      requestNode("r1"),
      requestNode("r2"),
      requestNode("r3"),
      folder("F1", [requestNode("r4"), folder("F2", [requestNode("r5")])]),
    ]),
    collection("B", [requestNode("r6"), folder("F3", [])]),
  ];
}

describe("locateNode", () => {
  it("finds the collection, parent folder and index of a node at any depth", () => {
    const cols = fixture();
    expect(locateNode(cols, "r2")).toEqual({ collectionId: "A", parentFolderId: null, index: 1 });
    expect(locateNode(cols, "r5")).toEqual({ collectionId: "A", parentFolderId: "F2", index: 0 });
    expect(locateNode(cols, "F3")).toEqual({ collectionId: "B", parentFolderId: null, index: 1 });
    expect(locateNode(cols, "nope")).toBeUndefined();
  });
});

describe("moveNode", () => {
  it("moves a node down within the same parent (the gap index counts the node itself)", () => {
    const out = moveNode(fixture(), "r1", { collectionId: "A", parentFolderId: null, index: 3 });
    expect(shape(out[0].items)).toEqual(["r2", "r3", "r1", ["F1", ["r4", ["F2", ["r5"]]]]]);
  });

  it("moves a node up within the same parent", () => {
    const out = moveNode(fixture(), "r3", { collectionId: "A", parentFolderId: null, index: 0 });
    expect(shape(out[0].items)).toEqual(["r3", "r1", "r2", ["F1", ["r4", ["F2", ["r5"]]]]]);
  });

  it("moves to the very end of the same parent", () => {
    const out = moveNode(fixture(), "r1", { collectionId: "A", parentFolderId: null, index: 4 });
    expect(shape(out[0].items)).toEqual(["r2", "r3", ["F1", ["r4", ["F2", ["r5"]]]], "r1"]);
  });

  it("moves a request into a nested folder, at the given position", () => {
    const out = moveNode(fixture(), "r2", { collectionId: "A", parentFolderId: "F2", index: 0 });
    expect(shape(out[0].items)).toEqual(["r1", "r3", ["F1", ["r4", ["F2", ["r2", "r5"]]]]]);
  });

  it("moves a request out of a folder to the collection root", () => {
    const out = moveNode(fixture(), "r5", { collectionId: "A", parentFolderId: null, index: 1 });
    expect(shape(out[0].items)).toEqual(["r1", "r5", "r2", "r3", ["F1", ["r4", ["F2", []]]]]);
  });

  it("moves a request into another collection (appended to an empty folder)", () => {
    const out = moveNode(fixture(), "r1", { collectionId: "B", parentFolderId: "F3", index: 0 });
    expect(shapes(out)).toEqual({
      A: ["r2", "r3", ["F1", ["r4", ["F2", ["r5"]]]]],
      B: ["r6", ["F3", ["r1"]]],
    });
  });

  it("moves a whole folder, with its contents, across collections", () => {
    const out = moveNode(fixture(), "F1", { collectionId: "B", parentFolderId: null, index: 0 });
    expect(shapes(out)).toEqual({
      A: ["r1", "r2", "r3"],
      B: [["F1", ["r4", ["F2", ["r5"]]]], "r6", ["F3", []]],
    });
  });

  it("moves a folder up into its grandparent", () => {
    const out = moveNode(fixture(), "F2", { collectionId: "A", parentFolderId: null, index: 0 });
    expect(shape(out[0].items)).toEqual([["F2", ["r5"]], "r1", "r2", "r3", ["F1", ["r4"]]]);
  });

  it("keeps the moved node object (and its id) intact", () => {
    const before = fixture();
    const r4 = (before[0].items[3] as Extract<TreeNode, { type: "folder" }>).children[0];
    const out = moveNode(before, "r4", { collectionId: "B", parentFolderId: null, index: 2 });
    expect(out[1].items[2]).toBe(r4);
  });

  it("refuses to move a folder into itself or one of its descendants", () => {
    const cols = fixture();
    expect(moveNode(cols, "F1", { collectionId: "A", parentFolderId: "F1", index: 0 })).toBe(cols);
    expect(moveNode(cols, "F1", { collectionId: "A", parentFolderId: "F2", index: 0 })).toBe(cols);
  });

  it("refuses unknown nodes, collections and parent folders (or a request used as a parent)", () => {
    const cols = fixture();
    expect(moveNode(cols, "nope", { collectionId: "A", parentFolderId: null, index: 0 })).toBe(cols);
    expect(moveNode(cols, "r1", { collectionId: "Z", parentFolderId: null, index: 0 })).toBe(cols);
    expect(moveNode(cols, "r1", { collectionId: "A", parentFolderId: "F3", index: 0 })).toBe(cols); // F3 is in B
    expect(moveNode(cols, "r1", { collectionId: "A", parentFolderId: "r2", index: 0 })).toBe(cols);
  });

  it("is a no-op (same array) when the node would land where it already is", () => {
    const cols = fixture();
    expect(moveNode(cols, "r2", { collectionId: "A", parentFolderId: null, index: 1 })).toBe(cols); // gap before itself
    expect(moveNode(cols, "r2", { collectionId: "A", parentFolderId: null, index: 2 })).toBe(cols); // gap after itself
    expect(moveNode(cols, "r5", { collectionId: "A", parentFolderId: "F2", index: 1 })).toBe(cols);
  });

  it("clamps an out-of-range index", () => {
    const out = moveNode(fixture(), "r6", { collectionId: "A", parentFolderId: "F1", index: 99 });
    expect(shape(out[0].items)[3]).toEqual(["F1", ["r4", ["F2", ["r5"]], "r6"]]);
  });

  it("does not mutate its input", () => {
    const cols = fixture();
    const snapshot = JSON.stringify(cols);
    moveNode(cols, "r1", { collectionId: "B", parentFolderId: "F3", index: 0 });
    moveNode(cols, "F2", { collectionId: "A", parentFolderId: null, index: 0 });
    expect(JSON.stringify(cols)).toBe(snapshot);
  });
});

describe("siblingStep", () => {
  it("gives the target one step up or down among the siblings", () => {
    const cols = fixture();
    expect(moveNode(cols, "r2", siblingStep(cols, "r2", -1)!)[0].items.map((n) => n.id)).toEqual(["r2", "r1", "r3", "F1"]);
    expect(moveNode(cols, "r2", siblingStep(cols, "r2", 1)!)[0].items.map((n) => n.id)).toEqual(["r1", "r3", "r2", "F1"]);
  });

  it("is undefined at the edges", () => {
    const cols = fixture();
    expect(siblingStep(cols, "r1", -1)).toBeUndefined();
    expect(siblingStep(cols, "F1", 1)).toBeUndefined();
    expect(siblingStep(cols, "r5", 1)).toBeUndefined();
    expect(siblingStep(cols, "nope", 1)).toBeUndefined();
  });
});

describe("moveCollection", () => {
  const three = () => [collection("A", []), collection("B", []), collection("C", [])];
  const ids = (cols: Collection[]) => cols.map((c) => c.id);

  it("moves a collection down or up (gap indexes)", () => {
    expect(ids(moveCollection(three(), "A", 3))).toEqual(["B", "C", "A"]);
    expect(ids(moveCollection(three(), "A", 2))).toEqual(["B", "A", "C"]);
    expect(ids(moveCollection(three(), "C", 0))).toEqual(["C", "A", "B"]);
  });

  it("is a no-op (same array) for its own position or an unknown id", () => {
    const cols = three();
    expect(moveCollection(cols, "B", 1)).toBe(cols);
    expect(moveCollection(cols, "B", 2)).toBe(cols);
    expect(moveCollection(cols, "Z", 0)).toBe(cols);
  });
});

// ---- structural sharing ---------------------------------------------------------------------

type Folder = Extract<TreeNode, { type: "folder" }>;
const kids = (n: TreeNode) => (n as Folder).children;

describe("updates share untouched structure", () => {
  it("updateRequestInCollections only renews the path to the edited request", () => {
    const cols = fixture();
    const out = updateRequestInCollections(cols, "r5", (r) => ({ ...r, url: "/x" }));
    expect(out).not.toBe(cols);
    expect(out[1]).toBe(cols[1]); // other collection
    const [a, before] = [out[0], cols[0]];
    expect(a).not.toBe(before);
    for (const i of [0, 1, 2]) expect(a.items[i]).toBe(before.items[i]); // sibling requests
    const f1 = a.items[3];
    expect(f1).not.toBe(before.items[3]);
    expect(kids(f1)[0]).toBe(kids(before.items[3])[0]); // r4, beside the path
    const f2 = kids(f1)[1];
    expect((kids(f2)[0] as Extract<TreeNode, { type: "request" }>).request.url).toBe("/x");
    expect(a.variables).toBe(before.variables);
  });

  it("returns the same array when the request is unknown or the updater changes nothing", () => {
    const cols = fixture();
    expect(updateRequestInCollections(cols, "nope", (r) => ({ ...r, url: "/x" }))).toBe(cols);
    expect(updateRequestInCollections(cols, "r5", (r) => r)).toBe(cols);
  });

  it("renameNode, removeNode and addNode keep siblings and untouched folders", () => {
    const items = fixture()[0].items;
    const renamed = renameNode(items, "r4", "Four");
    for (const i of [0, 1, 2]) expect(renamed[i]).toBe(items[i]);
    expect(kids(renamed[3])[1]).toBe(kids(items[3])[1]); // F2
    expect(renameNode(items, "nope", "x")).toBe(items);

    const removed = removeNode(items, "r5");
    expect(removed[0]).toBe(items[0]);
    expect(kids(removed[3])[0]).toBe(kids(items[3])[0]);
    expect(kids(kids(removed[3])[1])).toEqual([]);
    expect(removeNode(items, "nope")).toBe(items);

    const added = addNode(items, "F1", requestNode("n"));
    expect(added[0]).toBe(items[0]);
    expect(kids(added[3])[1]).toBe(kids(items[3])[1]);
    expect(kids(added[3]).map((n) => n.id)).toEqual(["r4", "F2", "n"]);
  });

  it("moveNode leaves collections and folders off the path alone", () => {
    const cols = [...fixture(), collection("C", [requestNode("r7")])];
    const out = moveNode(cols, "r1", { collectionId: "A", parentFolderId: "F2", index: 0 });
    expect(out[1]).toBe(cols[1]);
    expect(out[2]).toBe(cols[2]);
    expect(out[0].items[0]).toBe(cols[0].items[1]); // r2, shifted but the same object
    expect(kids(out[0].items[2])[0]).toBe(kids(cols[0].items[3])[0]); // r4
  });
});

describe("indexRequests", () => {
  it("maps every request id to the request and its collection", () => {
    const cols = fixture();
    const index = indexRequests(cols);
    expect(index.size).toBe(6);
    expect(index.get("r5")?.collection).toBe(cols[0]);
    expect(index.get("r5")?.request).toBe((kids(kids(cols[0].items[3])[1])[0] as Extract<TreeNode, { type: "request" }>).request);
    expect(index.get("r6")?.collection).toBe(cols[1]);
    expect(index.get("F1")).toBeUndefined();
  });
});
