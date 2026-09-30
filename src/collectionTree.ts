import type { Collection, Environment, FolderNode, KeyValue, RequestNode, SatchelRequest, TreeNode } from "./types";
import { VARIABLE_PATTERN } from "./variableTokens";

const newId = () => crypto.randomUUID();

export function createCollection(name: string): Collection {
  return { id: newId(), name, variables: [], items: [] };
}

export function createEnvironment(name: string): Environment {
  return { id: newId(), name, variables: [] };
}

export function createFolder(name: string): FolderNode {
  return { type: "folder", id: newId(), name, children: [] };
}

export function createRequest(name: string): RequestNode {
  const id = newId();
  return {
    type: "request",
    id,
    request: {
      id,
      name,
      method: "GET",
      url: "",
      params: [],
      headers: [],
      auth: { type: "none" },
      body: { mode: "none" },
    },
  };
}

/*
 * Tree updates share structure: only the objects on the path from the root to a changed node are
 * new, everything else (untouched nodes, folders, children arrays, collections) is the same object
 * as before, and an update that changes nothing returns its input as is. The sidebar memoizes
 * rows by object identity and relies on this.
 */

/** items.map(fn), but the same array back when fn returned every item unchanged. */
function mapShared<T>(items: T[], fn: (item: T) => T): T[] {
  let out: T[] | null = null;
  for (let i = 0; i < items.length; i++) {
    const next = fn(items[i]);
    if (next !== items[i]) (out ??= items.slice())[i] = next;
  }
  return out ?? items;
}

/** A folder with new children, or the same folder when they didn't change. */
function withChildren(folder: FolderNode, children: TreeNode[]): FolderNode {
  return children === folder.children ? folder : { ...folder, children };
}

export function addNode(items: TreeNode[], parentFolderId: string | null, node: TreeNode): TreeNode[] {
  if (parentFolderId === null) return [...items, node];
  return mapShared(items, (n): TreeNode => {
    if (n.type !== "folder") return n;
    if (n.id === parentFolderId) return { ...n, children: [...n.children, node] };
    return withChildren(n, addNode(n.children, parentFolderId, node));
  });
}

export function removeNode(items: TreeNode[], id: string): TreeNode[] {
  const kept = items.some((n) => n.id === id) ? items.filter((n) => n.id !== id) : items;
  return mapShared(kept, (n): TreeNode => (n.type === "folder" ? withChildren(n, removeNode(n.children, id)) : n));
}

export function renameNode(items: TreeNode[], id: string, name: string): TreeNode[] {
  return mapShared(items, (n): TreeNode => {
    if (n.id === id) {
      return n.type === "folder" ? { ...n, name } : { ...n, request: { ...n.request, name } };
    }
    return n.type === "folder" ? withChildren(n, renameNode(n.children, id, name)) : n;
  });
}

export function countRequests(items: TreeNode[]): number {
  return items.reduce((total, node) => total + (node.type === "request" ? 1 : countRequests(node.children)), 0);
}

export function findRequest(items: TreeNode[], id: string): SatchelRequest | undefined {
  for (const node of items) {
    if (node.type === "request") {
      if (node.id === id) return node.request;
    } else {
      const found = findRequest(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** An updater that returns the same request object leaves the tree as it is. */
export function updateRequest(
  items: TreeNode[],
  id: string,
  updater: (request: SatchelRequest) => SatchelRequest,
): TreeNode[] {
  return mapShared(items, (node): TreeNode => {
    if (node.type === "folder") return withChildren(node, updateRequest(node.children, id, updater));
    if (node.id !== id) return node;
    const request = updater(node.request);
    return request === node.request ? node : { ...node, request };
  });
}

/** Collections without the request (and all of them when nothing changed) are returned as they were. */
export function updateRequestInCollections(
  collections: Collection[],
  requestId: string,
  updater: (request: SatchelRequest) => SatchelRequest,
): Collection[] {
  return mapShared(collections, (collection) => withItems(collection, updateRequest(collection.items, requestId, updater)));
}

/** A collection with new items, or the same collection when they didn't change. */
export function withItems(collection: Collection, items: TreeNode[]): Collection {
  return items === collection.items ? collection : { ...collection, items };
}

/** Where a request is: the request and its collection. */
export interface RequestEntry {
  request: SatchelRequest;
  collection: Collection;
}

/** Every request by id, for O(1) lookups (the first one wins if an id repeats, as findRequest does). */
export function indexRequests(collections: readonly Collection[]): Map<string, RequestEntry> {
  const index = new Map<string, RequestEntry>();
  const visit = (items: readonly TreeNode[], collection: Collection) => {
    for (const node of items) {
      if (node.type === "folder") visit(node.children, collection);
      else if (!index.has(node.id)) index.set(node.id, { request: node.request, collection });
    }
  };
  for (const c of collections) visit(c.items, c);
  return index;
}

export function resolveVariables(text: string, variables: KeyValue[]): string {
  return text.replace(VARIABLE_PATTERN, (match, key) => {
    const found = variables.find((v) => v.key === key && v.enabled);
    return found ? found.value : match;
  });
}

/** Where a node sits: its collection, its parent folder (null = the collection root) and its index there. */
export interface NodeLocation {
  collectionId: string;
  parentFolderId: string | null;
  index: number;
}

/**
 * Where to put a moved node. `index` is a gap in the target parent's children *as they are now*
 * (0 = before the first child, children.length = after the last), like a drop indicator shows it —
 * moveNode compensates for the node's own removal when it stays in the same parent.
 */
export type MoveTarget = NodeLocation;

export function locateNode(collections: readonly Collection[], nodeId: string): NodeLocation | undefined {
  const inItems = (items: readonly TreeNode[], collectionId: string, parentFolderId: string | null): NodeLocation | undefined => {
    for (let index = 0; index < items.length; index++) {
      const node = items[index];
      if (node.id === nodeId) return { collectionId, parentFolderId, index };
      if (node.type === "folder") {
        const found = inItems(node.children, collectionId, node.id);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const c of collections) {
    const found = inItems(c.items, c.id, null);
    if (found) return found;
  }
  return undefined;
}

function findNode(items: readonly TreeNode[], id: string): TreeNode | undefined {
  for (const node of items) {
    if (node.id === id) return node;
    if (node.type === "folder") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** The children list a node would go into: the collection root (null) or a folder's children. */
function childrenOf(collection: Collection, parentFolderId: string | null): TreeNode[] | undefined {
  if (parentFolderId === null) return collection.items;
  const folder = findNode(collection.items, parentFolderId);
  return folder?.type === "folder" ? folder.children : undefined;
}

function insertNode(items: TreeNode[], parentFolderId: string | null, index: number, node: TreeNode): TreeNode[] {
  if (parentFolderId === null) {
    const at = Math.max(0, Math.min(items.length, index));
    return [...items.slice(0, at), node, ...items.slice(at)];
  }
  return mapShared(items, (n): TreeNode => {
    if (n.type !== "folder") return n;
    if (n.id === parentFolderId) return { ...n, children: insertNode(n.children, null, index, node) };
    return withChildren(n, insertNode(n.children, parentFolderId, index, node));
  });
}

/**
 * Move a request or folder to another place in the same collection or another one.
 * Returns the same array (unchanged) when the move is invalid — unknown node or target, a folder
 * into itself or one of its descendants — or when it would leave the tree as it is.
 */
export function moveNode(collections: Collection[], nodeId: string, target: MoveTarget): Collection[] {
  const from = locateNode(collections, nodeId);
  if (!from) return collections;
  const source = collections.find((c) => c.id === from.collectionId)!;
  const node = findNode(source.items, nodeId)!;
  const dest = collections.find((c) => c.id === target.collectionId);
  if (!dest) return collections;
  const siblings = childrenOf(dest, target.parentFolderId);
  if (!siblings) return collections;
  if (node.type === "folder" && target.parentFolderId !== null) {
    // Into itself, or into a folder inside it.
    if (target.parentFolderId === node.id || findNode(node.children, target.parentFolderId)) return collections;
  }

  let index = Math.max(0, Math.min(siblings.length, target.index));
  const sameParent = from.collectionId === target.collectionId && from.parentFolderId === target.parentFolderId;
  if (sameParent) {
    if (index > from.index) index--;
    if (index === from.index) return collections;
  }

  const removed = collections.map((c) => (c.id === from.collectionId ? withItems(c, removeNode(c.items, nodeId)) : c));
  return removed.map((c) => (c.id === target.collectionId ? withItems(c, insertNode(c.items, target.parentFolderId, index, node)) : c));
}

/** Where a node lands when moved one step up (-1) or down (+1) among its siblings, or undefined at the edge. */
export function siblingStep(collections: readonly Collection[], nodeId: string, step: -1 | 1): MoveTarget | undefined {
  const at = locateNode(collections, nodeId);
  if (!at) return undefined;
  const collection = collections.find((c) => c.id === at.collectionId)!;
  const count = childrenOf(collection, at.parentFolderId)!.length;
  if (step < 0 ? at.index === 0 : at.index === count - 1) return undefined;
  // Gap semantics: one up is the gap before the previous sibling, one down the gap after the next one.
  return { ...at, index: step < 0 ? at.index - 1 : at.index + 2 };
}

/**
 * Reorder collections. `toIndex` is a gap in the current list (0…length), as for moveNode.
 * Returns the same array when nothing changes or the collection is unknown.
 */
export function moveCollection(collections: Collection[], collectionId: string, toIndex: number): Collection[] {
  const from = collections.findIndex((c) => c.id === collectionId);
  if (from < 0) return collections;
  let index = Math.max(0, Math.min(collections.length, toIndex));
  if (index > from) index--;
  if (index === from) return collections;
  const rest = collections.filter((c) => c.id !== collectionId);
  return [...rest.slice(0, index), collections[from], ...rest.slice(index)];
}
