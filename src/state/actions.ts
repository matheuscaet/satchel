import { toast } from "sonner";
import { useWorkspace } from "./workspace";
import { useSessionCore } from "./session";
import { useUi } from "./ui";
import { loadCurlParser } from "@/curlDetect";
import { readClipboardText } from "@/clipboard";
import { describeParsedCurl, requestNameFromUrl, tabForParsedCurl } from "@/features/curl/summary";

/** Cross-cutting user actions that touch more than one store. */
export function useAppActions() {
  const ws = useWorkspace();
  // Core only: a response or burst result arriving needn't re-render everything that uses these actions.
  const session = useSessionCore();
  const ui = useUi();

  function switchEnvironment(environmentId: string) {
    if (environmentId === ws.workspace.activeEnvironmentId) return;
    const env = ws.workspace.environments.find((e) => e.id === environmentId);
    if (!env) return;
    ws.setActiveEnvironment(environmentId);
    session.clearBlocker();
    session.bumpSweep();
    toast(`Switched to ${env.name}. Every {{variable}} was re-resolved.`);
  }

  /** Cycle to the next environment (⌘E). */
  function cycleEnvironment() {
    const envs = ws.workspace.environments;
    if (envs.length === 0) return;
    const i = envs.findIndex((e) => e.id === ws.workspace.activeEnvironmentId);
    switchEnvironment(envs[(i + 1) % envs.length].id);
  }

  function newRequest(collectionId: string | null = null, parentFolderId: string | null = null) {
    const id = ws.addRequest(collectionId, parentFolderId, { url: "{{baseUrl}}/" });
    ui.setForceFirstRun(false);
    session.openTab(id);
    session.requestUrlFocus(id);
    return id;
  }

  async function importCurlText(text: string): Promise<boolean> {
    const { parseCurl, CurlParseError } = await loadCurlParser();
    let parsed;
    try {
      parsed = parseCurl(text);
    } catch (err) {
      toast.error(err instanceof CurlParseError ? err.message : "Couldn't parse that as a curl command.");
      return false;
    }
    const id = ws.addRequest(null, null, {
      name: requestNameFromUrl(parsed.url),
      method: parsed.method,
      url: parsed.url,
      params: parsed.params,
      headers: parsed.headers,
      body: parsed.body,
      auth: parsed.auth,
    });
    ui.setForceFirstRun(false);
    session.openTab(id);
    session.setRequestTab(id, tabForParsedCurl(parsed));
    toast(`Parsed cURL: ${describeParsedCurl(parsed)}`, parsed.warnings.length ? { description: parsed.warnings.join(" ") } : undefined);
    return true;
  }

  async function pasteCurlFromClipboard() {
    let text: string;
    try {
      text = await readClipboardText();
    } catch {
      toast.error("Couldn't read the clipboard. Copy a curl command first, then try again.");
      return;
    }
    await importCurlText(text);
  }

  return { switchEnvironment, cycleEnvironment, newRequest, importCurlText, pasteCurlFromClipboard };
}
