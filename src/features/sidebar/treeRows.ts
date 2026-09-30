import type { Collection, SatchelRequest, TreeNode, Workspace } from "@/types";

/** Where a row sits among its visible siblings, for aria-posinset / aria-setsize (1-based). */
interface SiblingPosition {
  posInSet: number;
  setSize: number;
}

/** One visible line of the sidebar tree, flattened in display order. */
export type TreeRowModel = SiblingPosition &
  (
    | { kind: "collection"; id: string; collectionId: string; name: string; depth: number; open: boolean; count: number }
    | {
        kind: "folder";
        id: string;
        collectionId: string;
        /** parent folder id, null at the collection root */
        parentId: string | null;
        name: string;
        depth: number;
        open: boolean;
        count: number;
      }
    | { kind: "request"; id: string; collectionId: string; parentId: string | null; request: SatchelRequest; depth: number }
  );

export function requestMatches(request: SatchelRequest, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return !f || `${request.name} ${request.url} ${request.method}`.toLowerCase().includes(f);
}

function countMatching(items: TreeNode[], filter: string): number {
  return items.reduce(
    (n, node) => n + (node.type === "request" ? (requestMatches(node.request, filter) ? 1 : 0) : countMatching(node.children, filter)),
    0,
  );
}

/**
 * Visible rows for the given filter and collapsed set.
 * A non-empty filter hides folders without matches and forces the rest open.
 */
export function visibleRows(collections: Collection[], filter: string, closed: ReadonlySet<string>): TreeRowModel[] {
  const filtering = filter.trim() !== "";
  const rows: TreeRowModel[] = [];
  // Rows are pushed before their siblings are all known: number each level once it's done.
  const numberSiblings = (siblings: TreeRowModel[]) =>
    siblings.forEach((row, i) => {
      row.posInSet = i + 1;
      row.setSize = siblings.length;
    });

  const walk = (items: TreeNode[], collectionId: string, parentId: string | null, depth: number) => {
    const siblings: TreeRowModel[] = [];
    for (const node of items) {
      if (node.type === "request") {
        if (requestMatches(node.request, filter)) {
          const row: TreeRowModel = { kind: "request", id: node.id, collectionId, parentId, request: node.request, depth, posInSet: 0, setSize: 0 };
          rows.push(row);
          siblings.push(row);
        }
        continue;
      }
      const count = countMatching(node.children, filter);
      if (filtering && count === 0) continue;
      const open = filtering || !closed.has(node.id);
      const row: TreeRowModel = { kind: "folder", id: node.id, collectionId, parentId, name: node.name, depth, open, count, posInSet: 0, setSize: 0 };
      rows.push(row);
      siblings.push(row);
      if (open) walk(node.children, collectionId, node.id, depth + 1);
    }
    numberSiblings(siblings);
  };

  const top: TreeRowModel[] = [];
  for (const c of collections) {
    const count = countMatching(c.items, filter);
    if (filtering && count === 0) continue;
    const open = filtering || !closed.has(c.id);
    const row: TreeRowModel = { kind: "collection", id: c.id, collectionId: c.id, name: c.name, depth: 0, open, count, posInSet: 0, setSize: 0 };
    rows.push(row);
    top.push(row);
    if (open) walk(c.items, c.id, null, 1);
  }
  numberSiblings(top);
  return rows;
}

/** Same row, field by field (the request is compared by identity: an unchanged request keeps its object). */
export function sameRow(a: TreeRowModel, b: TreeRowModel): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof TreeRowModel)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * `next` with every row that didn't change swapped for its object in `prev` — `prev` itself when
 * nothing changed — so memoized rows and anything keyed on `rows` skip the rebuild.
 */
export function keepUnchangedRows(prev: readonly TreeRowModel[], next: TreeRowModel[]): TreeRowModel[] {
  const before = new Map(prev.map((row) => [row.id, row]));
  let same = prev.length === next.length;
  const rows = next.map((row, i) => {
    const old = before.get(row.id);
    const kept = old && sameRow(old, row) ? old : row;
    if (kept !== prev[i]) same = false;
    return kept;
  });
  return same ? (prev as TreeRowModel[]) : rows;
}

/** Collection + folder ids that contain the node (outermost first), or [] if not found. */
export function ancestorIds(collections: Collection[], nodeId: string): string[] {
  const inItems = (items: TreeNode[], path: string[]): string[] | null => {
    for (const node of items) {
      if (node.id === nodeId) return path;
      if (node.type === "folder") {
        const found = inItems(node.children, [...path, node.id]);
        if (found) return found;
      }
    }
    return null;
  };
  for (const c of collections) {
    const found = inItems(c.items, [c.id]);
    if (found) return found;
  }
  return [];
}

/** Distinct variable names defined anywhere: globals, collections, environments. */
export function variableNameCount(workspace: Workspace): number {
  const names = new Set<string>();
  const add = (key: string) => key.trim() && names.add(key.trim());
  workspace.globals.forEach((v) => add(v.key));
  workspace.collections.forEach((c) => c.variables.forEach((v) => add(v.key)));
  workspace.environments.forEach((e) => e.variables.forEach((v) => add(v.key)));
  return names.size;
}

/** Ids of every collection and folder, for "Collapse all". */
export function containerIds(collections: readonly Collection[]): string[] {
  const ids: string[] = [];
  const walk = (items: readonly TreeNode[]) => {
    for (const n of items) {
      if (n.type !== "folder") continue;
      ids.push(n.id);
      walk(n.children);
    }
  };
  for (const c of collections) {
    ids.push(c.id);
    walk(c.items);
  }
  return ids;
}
