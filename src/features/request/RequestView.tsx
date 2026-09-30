import { useCallback, useEffect, useMemo, useRef, type ComponentProps } from "react";
import { toast } from "sonner";
import type { HttpMethod, SatchelRequest } from "@/types";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore, useSessionRuns, unresolvedVariables } from "@/state/session";
import { isResolved, type VariableContext } from "@/variables";
import { paramsFromUrl, pathParamNames } from "@/url";
import { loadCurlParser, loadedCurlParser, looksLikeCurl } from "@/curlDetect";
import type { ParsedCurl } from "@/curl";
import { applyParsedCurl, describeParsedCurl, tabForParsedCurl } from "@/features/curl/summary";
import { useCopyAsCurl } from "@/features/curl/useCopyAsCurl";
import { VariableHoverLayer } from "@/features/variables/VariableHover";
import { ResponsePane } from "@/features/response/ResponsePane";
import { UrlBar } from "./UrlBar";
import { ResolvedUrl } from "./ResolvedUrl";
import { SendBlockerBar } from "./SendBlockerBar";
import { RequestPane } from "./RequestPane";
import { SplitView } from "./SplitView";

const SWEEP_MS = 1400;

/** Keep pathVariables in step with the URL's /:name segments (drop only empty, orphaned ones). */
function syncPathVariables(url: string, previous: Record<string, string> | undefined): Record<string, string> {
  const names = pathParamNames(url);
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(previous ?? {})) if (v !== "" || names.includes(k)) next[k] = v;
  for (const n of names) if (next[n] === undefined) next[n] = "";
  return next;
}

function focusEnd(el: HTMLInputElement | null | undefined) {
  if (!el) return;
  el.focus();
  const n = el.value.length;
  el.setSelectionRange(n, n);
}

export function RequestView({ requestId }: { requestId: string }) {
  const ws = useWorkspace();
  const session = useSessionCore();
  const copyAsCurl = useCopyAsCurl();
  const viewRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const location = ws.findRequest(requestId);
  const request = location?.request;
  // Same as ws.variableContext(requestId), but kept while typing: the collection object changes with
  // every edit to any of its requests, and only its name and variables matter for resolving.
  const collection = location?.collection;
  const { activeEnvironment, workspace } = ws;
  const context = useMemo<VariableContext>(
    () => ({ environment: activeEnvironment, collection, globals: workspace.globals }),
    [activeEnvironment, collection?.id, collection?.name, collection?.variables, workspace.globals],
  );

  const { updateRequest } = ws;
  const update = useCallback((updater: (r: SatchelRequest) => SatchelRequest) => updateRequest(requestId, updater), [updateRequest, requestId]);

  // "New request" asks for the URL field to take focus.
  const { focusUrlOf, requestUrlFocus } = session;
  useEffect(() => {
    if (focusUrlOf !== requestId) return;
    focusEnd(urlRef.current);
    requestUrlFocus(null);
  }, [focusUrlOf, requestId, requestUrlFocus]);

  // Environment switch: sweep a highlight across every token, staggered in reading order.
  const sweepSeen = useRef(session.sweepKey);
  useEffect(() => {
    if (session.sweepKey === sweepSeen.current) return;
    sweepSeen.current = session.sweepKey;
    const view = viewRef.current;
    if (!view) return;
    view.querySelectorAll<HTMLElement>(".tok, [data-resolved-token]").forEach((el, i) => el.style.setProperty("--i", String(i)));
    view.classList.remove("sweep");
    void view.offsetWidth;
    view.classList.add("sweep");
    const t = setTimeout(() => view.classList.remove("sweep"), SWEEP_MS);
    return () => clearTimeout(t);
  }, [session.sweepKey]);

  const { setRequestTab } = session;
  const focusPathParam = useCallback(
    (name: string) => {
      setRequestTab(requestId, "params");
      setTimeout(() => focusEnd(viewRef.current?.querySelector<HTMLInputElement>(`[data-path-input="${CSS.escape(name)}"]`)), 30);
    },
    [setRequestTab, requestId],
  );

  // The response side depends only on the id: the same element lets React skip it while the request is edited.
  const responsePane = useMemo(() => <ResponsePane requestId={requestId} />, [requestId]);

  if (!request) return null;

  const blocker = session.blocker?.requestId === requestId ? session.blocker : null;
  const env = ws.activeEnvironment;

  const send = (force = false) => {
    session.send(requestId, { force });
    // An empty :path param holds the send back and opens Params: put the caret in it.
    const blocked = !force && unresolvedVariables(request, (k) => isResolved(k, context)).length > 0;
    const emptyPath = pathParamNames(request.url).find((n) => !request.pathVariables?.[n]);
    if (!blocked && !force && emptyPath) focusPathParam(emptyPath);
  };

  const cancel = () => {
    session.cancel(requestId);
    toast("Request cancelled.");
  };

  const setUrl = (url: string) =>
    update((r) => ({ ...r, url, params: paramsFromUrl(url, r.params), pathVariables: syncPathVariables(url, r.pathVariables) }));

  const setMethod = (method: HttpMethod) => update((r) => ({ ...r, method }));

  const applyCurl = (parsed: ParsedCurl) => {
    update((r) => applyParsedCurl(r, parsed));
    session.setRequestTab(requestId, tabForParsedCurl(parsed));
    toast(`Pasted cURL: ${describeParsedCurl(parsed)}`, parsed.warnings.length ? { description: parsed.warnings.join(" ") } : undefined);
  };

  // Pasting a curl command into the URL replaces this request's method, URL, params, headers, auth and
  // body in one update (one undo step, one save), then shows the tab with the most of what came in.
  const pasteText = (text: string): boolean => {
    if (!looksLikeCurl(text)) return false;
    const curl = loadedCurlParser();
    if (!curl) {
      // The parser is prefetched when the app goes idle; a paste before that takes the text now and
      // parses it once the parser loads. If it doesn't parse, the text goes where it was pasted.
      const input = urlRef.current;
      const [from, to] = [input?.selectionStart ?? request.url.length, input?.selectionEnd ?? request.url.length];
      const url = request.url;
      void loadCurlParser().then(({ parseCurl, CurlParseError }) => {
        try {
          applyCurl(parseCurl(text));
        } catch (err) {
          toast.error(err instanceof CurlParseError ? err.message : "Couldn't read that curl command.");
          setUrl(url.slice(0, from) + text + url.slice(to));
        }
      });
      return true;
    }
    let parsed;
    try {
      parsed = curl.parseCurl(text);
    } catch (err) {
      // Looked like curl but didn't parse: say why, and let the raw text land in the field.
      toast.error(err instanceof curl.CurlParseError ? err.message : "Couldn't read that curl command.");
      return false;
    }
    applyCurl(parsed);
    return true;
  };

  return (
    <div ref={viewRef} className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-line px-3 pt-2.5 pb-2">
        <SendingUrlBar
          requestId={requestId}
          method={request.method}
          url={request.url}
          context={context}
          onMethodChange={setMethod}
          onUrlChange={setUrl}
          onSend={() => send()}
          onCancel={cancel}
          onPasteText={pasteText}
          onCopyCurl={(resolve) => copyAsCurl(requestId, { resolve })}
          inputRef={urlRef}
        />
        <ResolvedUrl url={request.url} pathVariables={request.pathVariables} context={context} />
        {blocker && (
          <SendBlockerBar
            missing={blocker.missingVariables}
            environmentName={env?.name}
            onDefine={() => session.openEnvironments({ variable: blocker.missingVariables[0], environmentId: env?.id })}
            onSendAnyway={() => send(true)}
          />
        )}
      </div>
      <SplitView
        left={<RequestPane request={request} context={context} update={update} />}
        right={responsePane}
      />
      <VariableHoverLayer rootRef={viewRef} requestId={requestId} onEditPathParam={focusPathParam} />
    </div>
  );
}

/** The URL bar with the request's in-flight state, read here so a response arriving doesn't re-render the whole view. */
function SendingUrlBar({ requestId, ...props }: Omit<ComponentProps<typeof UrlBar>, "sending"> & { requestId: string }) {
  const sending = Boolean(useSessionRuns().sending[requestId]);
  return <UrlBar {...props} sending={sending} />;
}
