import { readSecret, writeSecret } from "./vault";
import { hasSecretValues, parseSecretValues, type SecretValues } from "./values";

/**
 * Secret values per vault account, remembering what's stored: saves only reach
 * the keychain when the values changed, and an account whose stored value
 * couldn't be read is never overwritten (that would replace real secrets with
 * blanks).
 */

/** The app's own workspace (no file or folder chosen). */
export const APP_ACCOUNT = "app";
/** A workspace folder, by the id in its .satchel/local.json. */
export const folderAccount = (id: string) => `workspace/${id}`;

interface Known {
  /** what the vault holds, as stored (null: nothing) */
  stored: string | null;
  readable: boolean;
}

const known = new Map<string, Known>();

function parse(text: string | null): SecretValues | null {
  if (text === null) return null;
  try {
    return parseSecretValues(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The account's values (null: none). Throws when the keychain can't be read; saves to it are then skipped. */
export async function loadSecretValues(account: string): Promise<SecretValues | null> {
  const k = known.get(account);
  if (k?.readable) return parse(k.stored);
  try {
    const stored = await readSecret(account);
    known.set(account, { stored, readable: true });
    return parse(stored);
  } catch (err) {
    known.set(account, { stored: null, readable: false });
    throw err;
  }
}

/** Store the account's values (removing the entry when there are none), if they changed. */
export async function saveSecretValues(account: string, values: SecretValues): Promise<void> {
  const next = hasSecretValues(values) ? JSON.stringify(values) : null;
  const k = known.get(account);
  if (k && !k.readable) return;
  if ((k?.stored ?? null) === next) return;
  await writeSecret(account, next);
  known.set(account, { stored: next, readable: true });
}
