import type { Environment, KeyValue, Workspace } from "@/types";
import type { VariableTarget } from "@/state/workspace";

/** One value column of the environments matrix: globals, a collection, or an environment. */
export interface MatrixColumn {
  /** "g", "c:<collectionId>", "e:<environmentId>" */
  key: string;
  label: string;
  /** Small uppercase line above the label */
  group: "Workspace" | "Collection" | "Environment";
  target: VariableTarget;
  variables: KeyValue[];
  environment?: Environment;
}

export const VARIABLE_NAME = /^[\w.-]+$/;

export const envColumnKey = (environmentId: string) => `e:${environmentId}`;
export const GLOBALS_KEY = "g";

export function matrixColumns(workspace: Workspace): MatrixColumn[] {
  return [
    { key: GLOBALS_KEY, label: "Globals", group: "Workspace", target: { scope: "globals" }, variables: workspace.globals },
    ...workspace.collections.map(
      (c): MatrixColumn => ({
        key: `c:${c.id}`,
        label: c.name,
        group: "Collection",
        target: { scope: "collection", id: c.id },
        variables: c.variables,
      }),
    ),
    ...workspace.environments.map(
      (e): MatrixColumn => ({
        key: envColumnKey(e.id),
        label: e.name,
        group: "Environment",
        target: { scope: "environment", id: e.id },
        variables: e.variables,
        environment: e,
      }),
    ),
  ];
}

/** Every variable name defined anywhere, plus `extra` names being filled in, sorted. */
export function matrixVariableNames(workspace: Workspace, extra: Iterable<string> = []): string[] {
  const names = new Set<string>(extra);
  for (const v of workspace.globals) names.add(v.key);
  for (const c of workspace.collections) for (const v of c.variables) names.add(v.key);
  for (const e of workspace.environments) for (const v of e.variables) names.add(v.key);
  names.delete("");
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function valueIn(column: MatrixColumn, name: string): string | undefined {
  return column.variables.find((v) => v.key === name)?.value;
}

/** What a secret value shows while it isn't being edited: a fixed length, so it doesn't leak the real one. */
export const SECRET_MASK = "••••••••";

/** Names marked secret in any column (the flag is per key, set in every scope at once). */
export function secretVariableNames(columns: MatrixColumn[]): Set<string> {
  const names = new Set<string>();
  for (const c of columns) for (const v of c.variables) if (v.secret && v.key) names.add(v.key);
  return names;
}

/** Whether any column holds a non-empty value for `name`. */
export function hasAnyValue(columns: MatrixColumn[], name: string): boolean {
  return columns.some((c) => (valueIn(c, name) ?? "") !== "");
}

/** The text to show for a value: masked when it's secret, not revealed, and not empty. */
export function displayValue(value: string, secret: boolean, revealed: boolean): string {
  return secret && !revealed && value !== "" ? SECRET_MASK : value;
}

/**
 * Cell width in ch: fits the column's label and longest value, clamped to 10–34.
 * Secret values count as the mask, so the column doesn't hint at their length.
 */
export function columnWidth(column: MatrixColumn, names: string[], secret: ReadonlySet<string> = new Set()): number {
  const longest = Math.max(0, ...names.map((n) => displayValue(valueIn(column, n) ?? "", secret.has(n), false).length + 1));
  return Math.min(34, Math.max(10, column.label.length + 2, longest));
}
