/**
 * The reason behind a rejection, for the UI. Tauri plugins reject with plain
 * strings rather than Error objects, so both are read before the fallback.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
