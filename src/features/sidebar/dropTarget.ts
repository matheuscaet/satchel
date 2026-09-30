import { locateNode, moveCollection, moveNode, type MoveTarget } from "@/collectionTree";
import type { Collection, TreeNode } from "@/types";
import type { TreeRowModel } from "./treeRows";

/** Left padding of a row at depth 0, and the indent per level (see TreeRow). */
export const ROW_PAD = 8;
export const ROW_INDENT = 18;

export type DropZone = "before" | "inside" | "after";

/** What the tree draws for a drop: a line at a row's top/bottom edge, indented to `depth`, or a highlighted row. */
export type DropIndicator = { type: "line"; rowId: string; edge: "top" | "bottom"; depth: number } | { type: "inside"; rowId: string };

export type Drop =
  | { kind: "node"; target: MoveTarget; indicator: DropIndicator }
  | { kind: "collection"; toIndex: number; indicator: DropIndicator };

export interface DragSource {
  id: string;
  kind: TreeRowModel["kind"];
}

/** Zone for a pointer at `rel` (0 = row top, 1 = row bottom). Containers get a middle "inside" band. */
export function zoneFor(kind: TreeRowModel["kind"], rel: number): DropZone {
  if (kind === "request") return rel < 0.5 ? "before" : "after";
  if (rel < 0.25) return "before";
  if (rel > 0.75) return "after";
  return "inside";
}

function childrenOf(collections: readonly Collection[], collectionId: string, folderId: string | null): TreeNode[] {
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return [];
  if (folderId === null) return collection.items;
  const find = (items: TreeNode[]): TreeNode[] | undefined => {
    for (const n of items) {
      if (n.type !== "folder") continue;
      if (n.id === folderId) return n.children;
      const found = find(n.children);
      if (found) return found;
    }
    return undefined;
  };
  return find(collection.items) ?? [];
}

/**
 * Resolve a hover into a concrete, valid drop — or null when it's refused (root-level requests,
 * a folder into its own subtree, a collection into a folder) or would change nothing.
 *
 * @param hoverIndex index of the hovered row in `rows` (the visible, unfiltered rows)
 * @param rel pointer position inside that row, 0 (top) … 1 (bottom)
 * @param pointerDepth tree depth under the pointer's x, to pick a level when dropping after the
 *                     last child of a folder (after the child, or after the folder itself…)
 */
export function resolveDrop(
  collections: Collection[],
  rows: readonly TreeRowModel[],
  source: DragSource,
  hoverIndex: number,
  rel: number,
  pointerDepth: number,
): Drop | null {
  const row = rows[hoverIndex];
  if (!row) return null;

  if (source.kind === "collection") {
    // Collections only go before/after other collections: take the hovered row's whole block
    // (collection row + its visible children) and split it in halves.
    const start = rows.findIndex((r) => r.id === row.collectionId);
    let end = start;
    while (end + 1 < rows.length && rows[end + 1].collectionId === row.collectionId) end++;
    const at = (hoverIndex - start + rel) / (end - start + 1);
    const ci = collections.findIndex((c) => c.id === row.collectionId);
    const drop: Drop =
      at < 0.5
        ? { kind: "collection", toIndex: ci, indicator: { type: "line", rowId: rows[start].id, edge: "top", depth: 0 } }
        : { kind: "collection", toIndex: ci + 1, indicator: { type: "line", rowId: rows[end].id, edge: "bottom", depth: 0 } };
    return moveCollection(collections, source.id, drop.toIndex) === collections ? null : drop;
  }

  const zone = zoneFor(row.kind, rel);
  let drop: Drop | null = null;

  if (row.kind === "collection") {
    const items = childrenOf(collections, row.id, null);
    if (zone === "inside") {
      drop = { kind: "node", target: { collectionId: row.id, parentFolderId: null, index: items.length }, indicator: { type: "inside", rowId: row.id } };
    } else if (zone === "after" && row.open && items.length > 0) {
      drop = {
        kind: "node",
        target: { collectionId: row.id, parentFolderId: null, index: 0 },
        indicator: { type: "line", rowId: row.id, edge: "bottom", depth: 1 },
      };
    }
    // "before" a collection, or after a closed one, would be the root level: refused.
  } else {
    const at = locateNode(collections, row.id);
    if (!at) return null;
    if (zone === "before") {
      drop = { kind: "node", target: at, indicator: { type: "line", rowId: row.id, edge: "top", depth: row.depth } };
    } else if (zone === "inside") {
      const children = childrenOf(collections, row.collectionId, row.id);
      drop = {
        kind: "node",
        target: { collectionId: row.collectionId, parentFolderId: row.id, index: children.length },
        indicator: { type: "inside", rowId: row.id },
      };
    } else if (row.kind === "folder" && row.open && childrenOf(collections, row.collectionId, row.id).length > 0) {
      // Right below an open folder's row is its first child's place.
      drop = {
        kind: "node",
        target: { collectionId: row.collectionId, parentFolderId: row.id, index: 0 },
        indicator: { type: "line", rowId: row.id, edge: "bottom", depth: row.depth + 1 },
      };
    } else {
      // After the row. When it's the last child of its folder, the same gap is also "after the
      // folder" (and after its parent, if that's last too…): the pointer's x picks the level.
      const levels: { target: MoveTarget; depth: number }[] = [{ target: { ...at, index: at.index + 1 }, depth: row.depth }];
      let cur = at;
      let depth = row.depth;
      while (cur.parentFolderId !== null && cur.index === childrenOf(collections, cur.collectionId, cur.parentFolderId).length - 1) {
        const parent = locateNode(collections, cur.parentFolderId);
        if (!parent) break;
        depth--;
        levels.push({ target: { ...parent, index: parent.index + 1 }, depth });
        cur = parent;
      }
      const want = Math.max(levels[levels.length - 1].depth, Math.min(row.depth, pointerDepth));
      const level = levels.find((l) => l.depth === want) ?? levels[0];
      drop = { kind: "node", target: level.target, indicator: { type: "line", rowId: row.id, edge: "bottom", depth: level.depth } };
    }
  }

  if (!drop || drop.kind !== "node") return drop;
  // moveNode refuses a folder into its own subtree and returns the same array for no-ops.
  return moveNode(collections, source.id, drop.target) === collections ? null : drop;
}
