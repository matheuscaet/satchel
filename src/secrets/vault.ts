import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { isTauri } from "@/platform";

/**
 * Where secret variable values are kept: the system keychain (src-tauri/src/secrets.rs),
 * one text value per account. Without a keychain the desktop app falls back to a private
 * file in its data folder; in the browser (vite dev) values only live for the session.
 */

export type VaultBackend = "keychain" | "file" | "memory";

const memory = new Map<string, string>();
let warnedFallback = false;

function noteBackend(backend: VaultBackend) {
  if (backend !== "file" || warnedFallback) return;
  warnedFallback = true;
  toast("No system keychain is available, so secret values are kept in a private file in Satchel's data folder.");
}

/** The stored value, or null when there is none. Throws when the keychain is there but can't be read. */
export async function readSecret(account: string): Promise<string | null> {
  if (!isTauri()) return memory.get(account) ?? null;
  const { value, backend } = await invoke<{ value: string | null; backend: VaultBackend }>("secrets_get", { account });
  noteBackend(backend);
  return value;
}

/** Store a value; null removes it. */
export async function writeSecret(account: string, value: string | null): Promise<void> {
  if (!isTauri()) {
    if (value === null) memory.delete(account);
    else memory.set(account, value);
    return;
  }
  if (value === null) return invoke("secrets_delete", { account });
  noteBackend(await invoke<VaultBackend>("secrets_set", { account, value }));
}
