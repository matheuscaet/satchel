import type { ReactNode } from "react";
import { useSession, type ResponseEntry, type ResponseTab } from "@/state/session";
import { useWorkspace } from "@/state/workspace";
import type { HttpResponse } from "@/http/send";
import { BurstPanel } from "@/features/burst/BurstPanel";
import { EmptyResponse, ResponseNote } from "./EmptyResponse";
import { HeadersTable } from "./HeadersTable";
import { ResponseMeta } from "./ResponseMeta";
import { ResponseTabs, type ResponseTabItem } from "./ResponseTabs";
import { ResponseViewer } from "./viewer/ResponseViewer";
import { openResponsePopout } from "./popout/transport";
import { snapshotOf } from "./popout/snapshot";

// Stable per-entry keys, so the body fades in once per new response rather than on every render.
const entryKeys = new WeakMap<object, number>();
let nextKey = 0;
function entryKey(entry: object): number {
  let k = entryKeys.get(entry);
  if (k === undefined) entryKeys.set(entry, (k = ++nextKey));
  return k;
}

/** Right half of the request split: response body/headers, or the burst results. */
export function ResponsePane({ requestId }: { requestId: string }) {
  const session = useSession();
  const entry = session.responses[requestId];
  const sending = !!session.sending[requestId];
  const run = session.bursts[requestId];
  const tab = session.responseTab(requestId);
  const response = entry?.kind === "ok" ? entry.response : undefined;

  const tabs: ResponseTabItem[] = [
    { id: "body", label: "Body" },
    { id: "headers", label: "Headers", count: response ? String(response.headers.length) : undefined },
  ];
  if (run) tabs.push({ id: "burst", label: "Burst", count: run.running ? `${run.results.length}/${run.total}` : undefined });

  return (
    <section aria-label="Response" className="grid min-h-0 min-w-0 grid-rows-[36px_1fr]">
      <ResponseTabs
        tabs={tabs}
        active={tab}
        onSelect={(t) => session.setResponseTab(requestId, t)}
        meta={tab !== "burst" && <ResponseMeta entry={entry} sending={sending} />}
      />
      {/* The body viewer keeps its toolbar pinned and scrolls itself; everything else scrolls here. */}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">
        {tab === "burst" && run ? (
          <div className="min-h-0 overflow-auto">
            <BurstPanel run={run} />
          </div>
        ) : sending ? (
          <div className="h-[1.5px] origin-left animate-progress self-start bg-brass" />
        ) : !entry ? (
          <EmptyResponse />
        ) : (
          <div key={`${tab}-${entryKey(entry)}`} className="grid min-h-0 min-w-0 animate-fade-in grid-cols-[minmax(0,1fr)]">
            <ResponseBody requestId={requestId} entry={entry} tab={tab} />
          </div>
        )}
      </div>
    </section>
  );
}

function ResponseBody({ requestId, entry, tab }: { requestId: string; entry: ResponseEntry; tab: ResponseTab }): ReactNode {
  const ws = useWorkspace();
  if (entry.kind === "error") {
    return (
      <Scroll>
        {tab === "headers" ? (
          <ResponseNote>No headers. The request failed before a response arrived.</ResponseNote>
        ) : (
          <ResponseNote className="whitespace-pre-wrap text-fg2 select-text">{entry.message}</ResponseNote>
        )}
      </Scroll>
    );
  }
  const r: HttpResponse = entry.response;
  if (tab === "headers") {
    return <Scroll>{r.headers.length ? <HeadersTable headers={r.headers} /> : <ResponseNote>The response has no headers.</ResponseNote>}</Scroll>;
  }
  if (r.rawBodyText === "") {
    return (
      <Scroll>
        <ResponseNote>
          {r.status}
          {r.statusText ? ` ${r.statusText}` : ""}. The response has no body.
        </ResponseNote>
      </Scroll>
    );
  }
  const openWindow = () => {
    const loc = ws.findRequest(requestId);
    if (loc) void openResponsePopout(snapshotOf(loc.request, r));
  };
  return <ResponseViewer variant="pane" rawText={r.rawBodyText} isJson={r.isJson} onOpenWindow={openWindow} />;
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="min-h-0 overflow-auto">{children}</div>;
}
