import { memo, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/state/theme";
import { WorkspaceProvider, useWorkspace } from "@/state/workspace";
import { SessionProvider, useSessionCore, ENVIRONMENTS_TAB } from "@/state/session";
import { UiProvider, useUi } from "@/state/ui";
import { GitProvider } from "@/state/git";
import { loadCurlParser } from "@/curlDetect";
import { AppHeader } from "@/features/shell/AppHeader";
import { AppFooter } from "@/features/shell/AppFooter";
import { GlobalShortcuts } from "@/features/shell/useGlobalShortcuts";
import { NativeContextMenuGuard } from "@/features/shell/useSuppressNativeContextMenu";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { TabStrip } from "@/features/tabs/TabStrip";
import { RequestView } from "@/features/request/RequestView";
import { DropImportOverlay } from "@/features/import/DropImportOverlay";
import { EmptyView } from "@/features/shell/EmptyView";
import { onDemand } from "@/features/shell/onDemand";
import { FolderSetupDialog } from "@/features/workspace/FolderSetupDialog";
import { cn } from "@/lib/utils";

// Rarely used, heavier screens load when first shown. The palette is prefetched
// once the app is idle so ⌘K still opens it at once.
const CommandPalette = onDemand(() => import("@/features/palette/CommandPalette").then((m) => m.CommandPalette));
const FirstRun = onDemand(() => import("@/features/onboarding/FirstRun").then((m) => m.FirstRun));
const EnvironmentMatrix = onDemand(() => import("@/features/environments/EnvironmentMatrix").then((m) => m.EnvironmentMatrix));
const EnvironmentDialog = onDemand(() => import("@/features/environments/EnvironmentDialog").then((m) => m.EnvironmentDialog));
const PostmanImportDialog = onDemand(() => import("@/features/import/PostmanImportDialog").then((m) => m.PostmanImportDialog));

function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1200);
  return () => clearTimeout(id);
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <SessionProvider>
          <UiProvider>
            <GitProvider>
              <TooltipProvider delayDuration={300}>
                <Shell />
                <Toaster
                  position="bottom-right"
                  offset={{ bottom: 36, right: 14 }}
                  toastOptions={{
                    unstyled: true,
                    classNames: {
                      // The mockup's toast: compact card, brass dot, optional underlined action.
                      toast:
                        "flex w-full max-w-[420px] items-center gap-2.5 rounded-lg bg-bg1 px-3 py-[9px] text-[12.5px] text-fg shadow-pop before:size-1.5 before:flex-none before:rounded-full before:bg-brass data-[type=error]:before:bg-err",
                      icon: "hidden",
                      actionButton: "ml-auto font-medium text-fg underline underline-offset-3",
                      cancelButton: "text-fg3",
                    },
                  }}
                />
              </TooltipProvider>
            </GitProvider>
          </UiProvider>
        </SessionProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}

/**
 * The layout. It reads no state itself: each region subscribes to what it
 * shows, so typing in the URL bar or a git poll re-renders only the parts
 * that depend on it.
 */
const Shell = memo(function Shell() {
  useEffect(
    () =>
      whenIdle(() => {
        void CommandPalette.preload();
        void loadCurlParser();
      }),
    [],
  );

  return (
    <div className="grid h-screen grid-rows-[44px_minmax(0,1fr)_24px]">
      <GlobalShortcuts />
      <NativeContextMenuGuard />
      <AppHeader />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] min-[820px]:grid-cols-[var(--sidebar-w,256px)_minmax(0,1fr)]">
        <Sidebar />
        <MainArea />
      </div>
      <AppFooter />
      <Overlays />
    </div>
  );
});

/** First run, or the tab strip over the active tab's view. */
function MainArea() {
  const ws = useWorkspace();
  const { tabs, activeTab: active } = useSessionCore();
  const { forceFirstRun } = useUi();

  const isEmpty = ws.workspace.collections.length === 0;
  const showFirstRun = forceFirstRun || (isEmpty && tabs.length === 0);

  return (
    <main className={cn("grid min-h-0 min-w-0 bg-bg1", !showFirstRun && "grid-rows-[36px_minmax(0,1fr)]")}>
      {showFirstRun ? (
        <FirstRun />
      ) : (
        <>
          <TabStrip />
          <div className="grid min-h-0 min-w-0">
            {active === ENVIRONMENTS_TAB ? (
              <EnvironmentMatrix />
            ) : active && ws.findRequest(active) ? (
              <RequestView key={active} requestId={active} />
            ) : (
              <EmptyView />
            )}
          </div>
        </>
      )}
    </main>
  );
}

/** Dialogs and overlays; the on-demand ones are mounted (and first loaded) only when open. */
function Overlays() {
  const ui = useUi();
  return (
    <>
      {ui.paletteOpen && <CommandPalette />}
      {ui.environmentDialog && <EnvironmentDialog />}
      {ui.postmanDialog && <PostmanImportDialog />}
      <DropImportOverlay />
      <FolderSetupDialog />
    </>
  );
}
