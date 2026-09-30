import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore, ENVIRONMENTS_TAB } from "@/state/session";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";
import { useGit } from "@/state/git";
import { useWorkspaceActions } from "@/features/workspace/useWorkspaceActions";
import { looksLikeCurl } from "@/curlDetect";

function dialogOpen(): boolean {
  return document.querySelector("[role=dialog][data-state=open]") !== null;
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/**
 * App-wide keyboard shortcuts and "paste a curl anywhere":
 * ⌘K palette · ⌘⇧G source control · ⌘↵ send · ⌘E cycle env · ⌘1–9 pick env · ⌘N new request · ⌘O open folder · Esc closes the sidebar overlay.
 */
export function useGlobalShortcuts() {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const actions = useAppActions();
  const wsActions = useWorkspaceActions();
  const git = useGit();

  // The listeners are attached once; they read the latest state through this ref.
  const latest = useRef({ ws, session, ui, actions, wsActions, git });
  useLayoutEffect(() => {
    latest.current = { ws, session, ui, actions, wsActions, git };
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { ws, session, ui, actions, wsActions, git } = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && !e.altKey && key === "k") {
        e.preventDefault();
        if (ui.paletteOpen) ui.setPaletteOpen(false);
        else if (!dialogOpen()) ui.setPaletteOpen(true);
        return;
      }
      // ⌘⇧G: the source control panel (a popover, so it counts as an open dialog: check it first).
      if (mod && e.shiftKey && !e.altKey && key === "g") {
        if (ws.source.kind !== "folder") return;
        e.preventDefault();
        if (ui.sourceControlOpen) ui.setSourceControlOpen(false);
        else if (git.available === false) toast(git.unavailableReason ?? "Git isn't available.");
        else if (git.repo && !git.repo.isRepo) toast("This folder isn't a git repository. Initialize one from the workspace menu.");
        else if (git.repo && !dialogOpen()) ui.setSourceControlOpen(true);
        return;
      }
      if (ui.paletteOpen || dialogOpen()) return;

      if (mod && e.key === "Enter") {
        const active = session.activeTab;
        if (!active || active === ENVIRONMENTS_TAB || !ws.findRequest(active)) return;
        e.preventDefault();
        // Let editors that commit on blur (body editor) flush before sending.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.isContentEditable) focused.blur();
        setTimeout(() => latest.current.session.send(active), 0);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "e") {
        e.preventDefault();
        actions.cycleEnvironment();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const env = ws.workspace.environments[Number(e.key) - 1];
        if (!env) return;
        e.preventDefault();
        actions.switchEnvironment(env.id);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "o") {
        e.preventDefault();
        void wsActions.openFolder();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "n") {
        e.preventDefault();
        actions.newRequest();
        ui.setSidebarOpen(false);
        return;
      }
      if (e.key === "Escape" && ui.sidebarOpen) {
        ui.setSidebarOpen(false);
      }
    }

    function onPaste(e: ClipboardEvent) {
      // The URL field (or another handler) already took this paste.
      if (e.defaultPrevented) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!looksLikeCurl(text)) return;
      if (dialogOpen() || latest.current.ui.paletteOpen) return;
      // Inputs (the URL field in particular) handle their own paste.
      if (isEditable(document.activeElement)) return;
      e.preventDefault();
      void latest.current.actions.importCurlText(text);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
}

/**
 * Mounts the shortcuts in a component of their own: they read git status, the
 * workspace and the session, and re-rendering null on each change costs nothing
 * where re-rendering the app shell would.
 */
export function GlobalShortcuts() {
  useGlobalShortcuts();
  return null;
}
