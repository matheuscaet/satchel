import { beforeEach, describe, expect, it } from "vitest";
import { closedToStore, loadClosed, saveClosed, treeStateKey } from "./treeState";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe("tree state", () => {
  it("keeps one state per workspace", () => {
    const folder = treeStateKey({ kind: "folder", root: "/repo/shop-api" });
    expect(folder).not.toBe(treeStateKey({ kind: "folder", root: "/repo/other" }));
    expect(treeStateKey({ kind: "file", path: "/w.json" })).not.toBe(treeStateKey({ kind: "cache" }));

    saveClosed(folder, ["c1", "f2"]);
    expect(loadClosed(folder)).toEqual(new Set(["c1", "f2"]));
    expect(loadClosed(treeStateKey({ kind: "cache" }))).toEqual(new Set());
  });

  it("stores only containers that still exist, and nothing when all are open", () => {
    expect(closedToStore(new Set(["c1", "gone", "f2"]), ["c1", "f2", "f3"])).toEqual(["c1", "f2"]);
    const key = treeStateKey({ kind: "cache" });
    saveClosed(key, ["c1"]);
    saveClosed(key, []);
    expect(store.has(key)).toBe(false);
  });

  it("reads a malformed entry as everything open", () => {
    const key = treeStateKey({ kind: "cache" });
    store.set(key, "{not json");
    expect(loadClosed(key)).toEqual(new Set());
    store.set(key, JSON.stringify(["ok", 3, null]));
    expect(loadClosed(key)).toEqual(new Set(["ok"]));
  });
});
