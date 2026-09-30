/**
 * Per-person state kept in `.satchel/local.json` (never shared, never committed):
 * which environment is active, where the values of secret variables are kept,
 * and paths of form-data files that live outside the workspace folder.
 */
export interface LocalState {
  activeEnvironmentId: string | null;
  /** The folder's account in the system keychain, which holds its secret values (see src/secrets/). */
  vault?: string;
  /**
   * Values of secret variables. In memory, what the serializer collected; on disk only in
   * folders saved before the keychain (they're moved into it on the next save).
   */
  secrets: {
    globals: Record<string, string>;
    /** collection id → variable → value */
    collections: Record<string, Record<string, string>>;
    /** environment id → variable → value */
    environments: Record<string, Record<string, string>>;
  };
  /** request id → form field index → absolute path on this machine */
  files: Record<string, Record<string, string>>;
}

export function emptyLocalState(): LocalState {
  return { activeEnvironmentId: null, secrets: { globals: {}, collections: {}, environments: {} }, files: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function stringMap(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function nestedStringMap(v: unknown): Record<string, Record<string, string>> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, stringMap(inner)]));
}

/** Lenient: anything malformed is dropped rather than failing the load — this file only holds conveniences. */
export function parseLocalState(json: unknown): LocalState {
  if (!isRecord(json)) return emptyLocalState();
  const secrets = isRecord(json.secrets) ? json.secrets : {};
  return {
    activeEnvironmentId: typeof json.activeEnvironmentId === "string" ? json.activeEnvironmentId : null,
    ...(typeof json.vault === "string" && /^[\w-]{1,64}$/.test(json.vault) ? { vault: json.vault } : {}),
    secrets: {
      globals: stringMap(secrets.globals),
      collections: nestedStringMap(secrets.collections),
      environments: nestedStringMap(secrets.environments),
    },
    files: nestedStringMap(json.files),
  };
}
