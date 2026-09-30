import { useWorkspace } from "@/state/workspace";
import { unresolvedVariables } from "@/state/session";
import { isResolved, mergedVariables } from "@/variables";
import { pathParamNames } from "@/url";
import { requestToCurl } from "@/curlExport";
import { copyWithToast } from "@/features/response/viewer/copy";

// Contract (implemented by the cURL work): copy a request as a curl command.
// `resolve` (default true): substitute {{variables}} and :path params with the active values, so the
// command runs as-is in a terminal; false keeps them as written.

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function useCopyAsCurl(): (requestId: string, opts?: { resolve?: boolean }) => void {
  const ws = useWorkspace();
  return (requestId, opts) => {
    const request = ws.findRequest(requestId)?.request;
    if (!request) return;
    const resolve = opts?.resolve ?? true;
    const context = ws.variableContext(requestId);
    const command = requestToCurl(request, resolve ? mergedVariables(context) : null);
    if (!resolve) {
      void copyWithToast(command, "Copied as cURL, with {{variables}}.");
      return;
    }

    const notes: string[] = [];
    const missing = unresolvedVariables(request, (k) => isResolved(k, context)).map((k) => `{{${k}}}`);
    if (missing.length) {
      const where = context.environment ? context.environment.name : "any scope";
      notes.push(
        missing.length === 1
          ? `${missing[0]} isn't defined in ${where}; it was left as written.`
          : `${listNames(missing)} aren't defined in ${where}; they were left as written.`,
      );
    }
    const emptyPath = pathParamNames(request.url)
      .filter((n) => !request.pathVariables?.[n])
      .map((n) => `:${n}`);
    if (emptyPath.length) {
      notes.push(
        emptyPath.length === 1 ? `${emptyPath[0]} has no value; it was left as written.` : `${listNames(emptyPath)} have no value; they were left as written.`,
      );
    }
    void copyWithToast(command, ["Copied as cURL.", ...notes].join(" "));
  };
}
