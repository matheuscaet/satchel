import { useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MethodLabel } from "@/components/common/MethodLabel";
import { Checkmark } from "@/components/common/Checkmark";
import { ThemeProvider } from "@/state/theme";
import type { ResponseTab } from "@/state/session";
import { ResponseViewer } from "../viewer/ResponseViewer";
import { ResponseTabs } from "../ResponseTabs";
import { StatusPill } from "../StatusPill";
import { HeadersTable } from "../HeadersTable";
import { formatSize } from "../format";
import { connectPopout } from "./transport";
import { useSuppressNativeContextMenu } from "@/features/shell/useSuppressNativeContextMenu";
import type { ResponseSnapshot } from "./snapshot";

/** Root of a pop-out response window (`/?popout=<id>`). */
export function ResponseWindowApp({ id }: { id: string }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <ResponseWindow id={id} />
        <Toaster
          position="bottom-right"
          offset={{ bottom: 14, right: 14 }}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                "flex w-full max-w-[420px] items-center gap-2.5 rounded-lg bg-bg1 px-3 py-[9px] text-[12.5px] text-fg shadow-pop before:size-1.5 before:flex-none before:rounded-full before:bg-brass data-[type=error]:before:bg-err",
              icon: "hidden",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function ResponseWindow({ id }: { id: string }) {
  useSuppressNativeContextMenu();
  const [snapshot, setSnapshot] = useState<ResponseSnapshot | null>(null);
  const [pending, setPending] = useState<ResponseSnapshot | null>(null);
  const [follow, setFollow] = useState(true);
  const [tab, setTab] = useState<ResponseTab>("body");
  const [timedOut, setTimedOut] = useState(false);

  // The transport callbacks are registered once; they read current state through refs.
  const followRef = useRef(follow);
  followRef.current = follow;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 4000);
    const stop = connectPopout(
      id,
      (s) => {
        clearTimeout(t);
        setSnapshot(s);
      },
      (s) => {
        if (snapshotRef.current?.requestId !== s.requestId) return;
        if (followRef.current) setSnapshot(s);
        else setPending(s);
      },
    );
    return () => {
      clearTimeout(t);
      stop();
    };
  }, [id]);

  useEffect(() => {
    if (snapshot) document.title = `${snapshot.method} ${snapshot.name} · Response`;
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className="grid h-screen place-items-center bg-bg1 text-fg3">
        {timedOut ? "This response is no longer available. Open it again from the main window." : "Loading response…"}
      </div>
    );
  }

  const time = new Date(snapshot.receivedAt).toLocaleTimeString();

  return (
    <div className="grid h-screen grid-rows-[44px_36px_minmax(0,1fr)] bg-bg1">
      <header className="flex min-w-0 items-center gap-2.5 border-b border-line bg-bg0 px-3.5">
        <MethodLabel method={snapshot.method} className="text-xs" />
        <span className="min-w-0 truncate font-medium">{snapshot.name}</span>
        <StatusPill status={snapshot.status} text={snapshot.statusText} />
        <span className="font-mono text-xs whitespace-nowrap text-fg2">{snapshot.timeMs} ms</span>
        <span className="font-mono text-xs whitespace-nowrap text-fg2">{formatSize(snapshot.sizeBytes)}</span>
        <span className="text-xs whitespace-nowrap text-fg3 max-[640px]:hidden">received {time}</span>
        <span className="flex-1" />
        {pending && (
          <button
            type="button"
            onClick={() => {
              setSnapshot(pending);
              setPending(null);
            }}
            className="h-6 rounded-md border border-brass-line px-2 text-xs whitespace-nowrap text-fg hover:bg-brass-soft"
          >
            New response · show
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs whitespace-nowrap text-fg2">
          <Checkmark
            checked={follow}
            label="Follow the latest response"
            onChange={(v) => {
              setFollow(v);
              if (v && pending) {
                setSnapshot(pending);
                setPending(null);
              }
            }}
          />
          Follow latest
        </label>
      </header>

      <ResponseTabs
        tabs={[
          { id: "body", label: "Body" },
          { id: "headers", label: "Headers", count: String(snapshot.headers.length) },
        ]}
        active={tab}
        onSelect={setTab}
      />

      <div className="min-h-0 min-w-0">
        {tab === "headers" ? (
          <div className="h-full overflow-auto">
            <HeadersTable headers={snapshot.headers} />
          </div>
        ) : snapshot.rawBodyText === "" ? (
          <div className="px-3 py-3.5 text-[12.5px] text-fg3">
            {snapshot.status} {snapshot.statusText}. The response has no body.
          </div>
        ) : (
          <ResponseViewer
            key={snapshot.receivedAt}
            variant="window"
            rawText={snapshot.rawBodyText}
            isJson={snapshot.isJson}
          />
        )}
      </div>
    </div>
  );
}
