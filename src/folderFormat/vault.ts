import { LOCAL_FILE, toJson, type FileMap } from "./layout";
import { emptyLocalState, parseLocalState, type LocalState } from "./local";

/** local.json as the app wrote it; anything unreadable counts as empty (it only holds conveniences). */
function readLocal(files: FileMap): LocalState {
  const text = files.get(LOCAL_FILE);
  if (text === undefined) return emptyLocalState();
  try {
    return parseLocalState(JSON.parse(text));
  } catch {
    return emptyLocalState();
  }
}

/**
 * The folder's keychain account id, and whether local.json still holds secret
 * values in plain text (written before secrets moved to the keychain).
 */
export function localVault(files: FileMap): { id: string | null; inline: boolean } {
  const { vault, secrets } = readLocal(files);
  const inline =
    Object.keys(secrets.globals).length > 0 ||
    [...Object.values(secrets.collections), ...Object.values(secrets.environments)].some((m) => Object.keys(m).length > 0);
  return { id: vault ?? null, inline };
}

/**
 * Take the secret values out of a serialized folder: local.json keeps the
 * keychain account id instead, and the values are returned for the keychain.
 */
export function detachSecrets(files: FileMap, vaultId: string): { files: FileMap; secrets: LocalState["secrets"] } {
  const local = readLocal(files);
  const out = new Map(files);
  const { secrets, ...rest } = local;
  out.set(LOCAL_FILE, toJson({ ...rest, vault: vaultId }));
  return { files: out, secrets };
}
