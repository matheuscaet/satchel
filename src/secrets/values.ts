import type { KeyValue, Workspace } from "@/types";
import { parseLocalState, type LocalState } from "@/folderFormat";

/** Values of secret variables by scope: the shape kept in the keychain (and, before it, in .satchel/local.json). */
export type SecretValues = LocalState["secrets"];

export function emptySecretValues(): SecretValues {
  return { globals: {}, collections: {}, environments: {} };
}

/** Lenient, like the rest of the personal state: anything malformed is dropped. */
export function parseSecretValues(json: unknown): SecretValues {
  return parseLocalState({ secrets: json }).secrets;
}

export function hasSecretValues(s: SecretValues): boolean {
  return (
    Object.keys(s.globals).length > 0 ||
    Object.values(s.collections).some((m) => Object.keys(m).length > 0) ||
    Object.values(s.environments).some((m) => Object.keys(m).length > 0)
  );
}

function valuesOf(list: readonly KeyValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of list) if (v.secret && v.value !== "") out[v.key] = v.value;
  return out;
}

/** The non-empty secret values in a workspace. */
export function secretValuesOf(w: Workspace): SecretValues {
  const scoped = (items: readonly { id: string; variables: KeyValue[] }[]) =>
    Object.fromEntries(items.map((x) => [x.id, valuesOf(x.variables)]).filter(([, m]) => Object.keys(m).length > 0));
  return { globals: valuesOf(w.globals), collections: scoped(w.collections), environments: scoped(w.environments) };
}

function fill(list: KeyValue[], values: Record<string, string> | undefined): KeyValue[] {
  if (!values || !list.some((v) => v.secret && values[v.key] !== undefined)) return list;
  return list.map((v) => (v.secret && values[v.key] !== undefined ? { ...v, value: values[v.key] } : v));
}

/** The workspace with stored secret values filled back into its secret variables. */
export function withSecretValues(w: Workspace, s: SecretValues): Workspace {
  return {
    ...w,
    globals: fill(w.globals, s.globals),
    collections: w.collections.map((c) => {
      const variables = fill(c.variables, s.collections[c.id]);
      return variables === c.variables ? c : { ...c, variables };
    }),
    environments: w.environments.map((e) => {
      const variables = fill(e.variables, s.environments[e.id]);
      return variables === e.variables ? e : { ...e, variables };
    }),
  };
}

const blank = (list: KeyValue[]): KeyValue[] =>
  list.some((v) => v.secret && v.value) ? list.map((v) => (v.secret ? { ...v, value: "" } : v)) : list;

/** The workspace with the values of secret variables blanked: what may go to localStorage. */
export function withoutSecretValues(w: Workspace): Workspace {
  return {
    ...w,
    globals: blank(w.globals),
    collections: w.collections.map((c) => ({ ...c, variables: blank(c.variables) })),
    environments: w.environments.map((e) => ({ ...e, variables: blank(e.variables) })),
  };
}
