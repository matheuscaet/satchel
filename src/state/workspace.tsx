import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Collection, Environment, FolderNode, KeyValue, SatchelRequest, TreeNode, Workspace } from "@/types";
import {
  addNode,
  createCollection,
  createFolder,
  createRequest,
  indexRequests,
  moveCollection,
  moveNode,
  removeNode,
  renameNode,
  updateRequestInCollections,
  withItems,
  type MoveTarget,
  type RequestEntry,
} from "@/collectionTree";
import { normalizeRequest } from "@/url";
import { setVariable, type VariableContext } from "@/variables";
import { initialWorkspace, usePersistence } from "./usePersistence";

type Persistence = ReturnType<typeof usePersistence>;
export type { SaveState, OpenFolderResult } from "./usePersistence";

/**
 * The persisted document: collections, environments, globals, active env.
 * Where it's saved (app cache, a legacy .json file, or a workspace folder)
 * and how is usePersistence's job.
 *
 * The context value only changes when something in it does: the actions are
 * stable for the provider's lifetime, and the lookups (findRequest,
 * variableContext, isSecretVariable) change with the data they read.
 */

export const ENV_SWATCHES = [
  "var(--ok)",
  "var(--m-get)",
  "var(--m-put)",
  "var(--m-patch)",
  "var(--m-query)",
  "var(--j-n)",
  "var(--err)",
  "var(--fg3)",
];

export type RequestLocation = RequestEntry;

export interface NewEnvironmentInput {
  name: string;
  color: string;
  /** Environment id to copy variables from */
  copyFromId?: string;
  activate?: boolean;
}

export type VariableTarget = { scope: "globals" } | { scope: "collection"; id: string } | { scope: "environment"; id: string };

interface WorkspaceValue extends Persistence, WorkspaceActions {
  workspace: Workspace;

  activeEnvironment: Environment | undefined;
  findRequest: (requestId: string) => RequestLocation | undefined;
  variableContext: (requestId: string | null) => VariableContext;
  /** Whether any scope marks this variable secret */
  isSecretVariable: (key: string) => boolean;
}

interface WorkspaceActions {
  // requests & tree
  updateRequest: (requestId: string, updater: (r: SatchelRequest) => SatchelRequest) => void;
  /** Adds a request (to the first collection when collectionId is null, creating one if needed). Returns its id. */
  addRequest: (collectionId: string | null, parentFolderId?: string | null, init?: Partial<SatchelRequest>) => string;
  addFolder: (collectionId: string, parentFolderId?: string | null) => string;
  addCollection: (name?: string) => string;
  /** Append an already-built collection (Postman import). */
  importCollection: (collection: Collection) => void;
  /** Append a folder with the given items to an existing collection, merging missing collection variables. */
  importIntoCollection: (collectionId: string, folder: FolderNode, variables: KeyValue[]) => void;
  renameCollection: (collectionId: string, name: string) => void;
  renameNode: (collectionId: string, nodeId: string, name: string) => void;
  deleteCollection: (collectionId: string) => void;
  deleteNode: (collectionId: string, nodeId: string) => void;
  /** Move a request or folder (see collectionTree.moveNode; invalid moves are ignored). */
  moveNode: (nodeId: string, target: MoveTarget) => void;
  /** Reorder collections; toIndex is a gap in the current list (0…length). */
  moveCollection: (collectionId: string, toIndex: number) => void;

  // environments & variables
  setActiveEnvironment: (environmentId: string | null) => void;
  createEnvironment: (input: NewEnvironmentInput) => Environment;
  /** Add environments as-is (Postman environment files). Names are de-duplicated. */
  addEnvironments: (environments: Environment[]) => Environment[];
  updateEnvironment: (environmentId: string, patch: Partial<Pick<Environment, "name" | "color">>) => void;
  /** Removes it and returns a function that restores it (for an Undo toast). */
  deleteEnvironment: (environmentId: string) => () => void;
  /** value === null removes the variable from that scope. A new entry for a secret variable is secret too. */
  setVariableIn: (target: VariableTarget, key: string, value: string | null) => void;
  /** Mark a variable secret (or not) in every scope that defines it. Secret values stay out of shared workspace files. */
  setVariableSecret: (key: string, secret: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function secretIn(w: Pick<Workspace, "globals" | "collections" | "environments">, key: string): boolean {
  const has = (list: KeyValue[]) => list.some((v) => v.key === key && v.secret);
  return has(w.globals) || w.collections.some((c) => has(c.variables)) || w.environments.some((e) => has(e.variables));
}

/** Set or clear the secret flag on `key` in a list (other entries untouched; the list is reused when nothing changes). */
function markSecret(list: KeyValue[], key: string, secret: boolean): KeyValue[] {
  if (!list.some((v) => v.key === key && !!v.secret !== secret)) return list;
  return list.map((v) => {
    if (v.key !== key) return v;
    if (secret) return { ...v, secret: true };
    const { secret: _drop, ...rest } = v;
    void _drop;
    return rest;
  });
}

function uniqueName(name: string, taken: string[]): string {
  let candidate = name;
  let n = 2;
  const lower = taken.map((t) => t.toLowerCase());
  while (lower.includes(candidate.toLowerCase())) candidate = `${name} ${n++}`;
  return candidate;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const persistence = usePersistence(workspace, setWorkspace);
  /** The workspace as last rendered, for the few actions that read it (so they can stay stable). */
  const latest = useRef(workspace);
  latest.current = workspace;
  const { collections, environments, globals, activeEnvironmentId } = workspace;

  // O(1) lookups; the index is built on first use after the collections change.
  const findRequest = useMemo(() => {
    let index: Map<string, RequestEntry> | null = null;
    return (requestId: string): RequestLocation | undefined => (index ??= indexRequests(collections)).get(requestId);
  }, [collections]);

  const activeEnvironment = environments.find((e) => e.id === activeEnvironmentId);

  const variableContext = useCallback(
    (requestId: string | null): VariableContext => ({
      environment: activeEnvironment,
      collection: requestId ? findRequest(requestId)?.collection : undefined,
      globals,
    }),
    [activeEnvironment, findRequest, globals],
  );

  const isSecretVariable = useCallback(
    (key: string) => secretIn({ globals, collections, environments }, key),
    [globals, collections, environments],
  );

  const actions = useMemo((): WorkspaceActions => {
    // Updates that change nothing keep the same workspace object, so nothing is marked unsaved.
    const setCollections = (fn: (c: Collection[]) => Collection[]) =>
      setWorkspace((w) => {
        const collections = fn(w.collections);
        return collections === w.collections ? w : { ...w, collections };
      });
    const setEnvironments = (fn: (e: Environment[]) => Environment[]) =>
      setWorkspace((w) => ({ ...w, environments: fn(w.environments) }));

    return {
      updateRequest: (requestId, updater) => setCollections((cols) => updateRequestInCollections(cols, requestId, updater)),
      addRequest: (collectionId, parentFolderId = null, init) => {
        const node = createRequest(init?.name ?? "New request");
        node.request = normalizeRequest({ ...node.request, ...init, id: node.id });
        setCollections((cols) => {
          if (cols.length === 0) return [{ ...createCollection("My requests"), items: [node] }];
          const target = collectionId ?? cols[0].id;
          return cols.map((c) => (c.id === target ? { ...c, items: addNode(c.items, parentFolderId, node) } : c));
        });
        return node.id;
      },
      addFolder: (collectionId, parentFolderId = null) => {
        const folder = createFolder("New folder");
        setCollections((cols) => cols.map((c) => (c.id === collectionId ? { ...c, items: addNode(c.items, parentFolderId, folder) } : c)));
        return folder.id;
      },
      addCollection: (name = "New collection") => {
        const collection = createCollection(name);
        setCollections((cols) => [...cols, collection]);
        return collection.id;
      },
      importCollection: (collection) => setCollections((cols) => [...cols, collection]),
      importIntoCollection: (collectionId, folder, variables) =>
        setCollections((cols) =>
          cols.map((c) => {
            if (c.id !== collectionId) return c;
            const missing = variables.filter((v) => !c.variables.some((cv) => cv.key === v.key));
            return { ...c, variables: [...c.variables, ...missing], items: [...c.items, folder] };
          }),
        ),
      renameCollection: (collectionId, name) => setCollections((cols) => cols.map((c) => (c.id === collectionId ? { ...c, name } : c))),
      renameNode: (collectionId, nodeId, name) =>
        setCollections((cols) => cols.map((c) => (c.id === collectionId ? withItems(c, renameNode(c.items, nodeId, name)) : c))),
      deleteCollection: (collectionId) => setCollections((cols) => cols.filter((c) => c.id !== collectionId)),
      deleteNode: (collectionId, nodeId) =>
        setCollections((cols) => cols.map((c) => (c.id === collectionId ? withItems(c, removeNode(c.items, nodeId)) : c))),
      moveNode: (nodeId, target) => setCollections((cols) => moveNode(cols, nodeId, target)),
      moveCollection: (collectionId, toIndex) => setCollections((cols) => moveCollection(cols, collectionId, toIndex)),

      setActiveEnvironment: (environmentId) => setWorkspace((w) => ({ ...w, activeEnvironmentId: environmentId })),
      createEnvironment: ({ name, color, copyFromId, activate }) => {
        const source = latest.current.environments.find((e) => e.id === copyFromId);
        const env: Environment = {
          id: crypto.randomUUID(),
          name,
          color,
          variables: source ? source.variables.map((v) => ({ ...v })) : [],
        };
        setWorkspace((w) => ({
          ...w,
          environments: [...w.environments, env],
          activeEnvironmentId: activate ? env.id : w.activeEnvironmentId,
        }));
        return env;
      },
      addEnvironments: (envs) => {
        const existing = latest.current.environments;
        const taken = existing.map((e) => e.name);
        const added = envs.map((e, i) => {
          const name = uniqueName(e.name, taken);
          taken.push(name);
          return { ...e, name, color: e.color ?? ENV_SWATCHES[(existing.length + i + 1) % ENV_SWATCHES.length] };
        });
        setEnvironments((list) => [...list, ...added]);
        return added;
      },
      updateEnvironment: (environmentId, patch) => setEnvironments((list) => list.map((e) => (e.id === environmentId ? { ...e, ...patch } : e))),
      deleteEnvironment: (environmentId) => {
        const before = latest.current;
        const index = before.environments.findIndex((e) => e.id === environmentId);
        const env = before.environments[index];
        const wasActive = before.activeEnvironmentId === environmentId;
        setWorkspace((w) => {
          const environments = w.environments.filter((e) => e.id !== environmentId);
          return {
            ...w,
            environments,
            activeEnvironmentId: w.activeEnvironmentId === environmentId ? (environments[0]?.id ?? null) : w.activeEnvironmentId,
          };
        });
        return () => {
          if (!env) return;
          setWorkspace((w) => {
            const environments = [...w.environments];
            environments.splice(index, 0, env);
            return { ...w, environments, activeEnvironmentId: wasActive ? env.id : w.activeEnvironmentId };
          });
        };
      },
      setVariableIn: (target, key, value) =>
        setWorkspace((w) => {
          const secret = secretIn(w, key);
          const set = (list: KeyValue[]) => markSecret(setVariable(list, key, value), key, secret);
          if (target.scope === "globals") return { ...w, globals: set(w.globals) };
          if (target.scope === "collection")
            return { ...w, collections: w.collections.map((c) => (c.id === target.id ? { ...c, variables: set(c.variables) } : c)) };
          return { ...w, environments: w.environments.map((e) => (e.id === target.id ? { ...e, variables: set(e.variables) } : e)) };
        }),
      setVariableSecret: (key, secret) =>
        setWorkspace((w) => {
          // Scopes that don't define the variable keep their objects.
          const mark = <T extends { variables: KeyValue[] }>(x: T): T => {
            const variables = markSecret(x.variables, key, secret);
            return variables === x.variables ? x : { ...x, variables };
          };
          return { ...w, globals: markSecret(w.globals, key, secret), collections: w.collections.map(mark), environments: w.environments.map(mark) };
        }),
    };
  }, []);

  const value = useMemo(
    (): WorkspaceValue => ({ ...persistence, ...actions, workspace, activeEnvironment, findRequest, variableContext, isSecretVariable }),
    [persistence, actions, workspace, activeEnvironment, findRequest, variableContext, isSecretVariable],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/** Depth-first first request id under a node list (to open after an import). */
export function firstRequestId(items: TreeNode[]): string | undefined {
  for (const n of items) {
    if (n.type === "request") return n.id;
    const found = firstRequestId(n.children);
    if (found) return found;
  }
  return undefined;
}
