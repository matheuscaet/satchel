import { useMemo, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  Download,
  File,
  FolderGit2,
  FolderOpen,
  FolderX,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  SquareTerminal,
  Sun,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { HttpMethod, SatchelRequest, TreeNode } from "@/types";
import { EnvDot } from "@/components/common/EnvDot";
import { MOD } from "@/components/common/Kbd";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore, ENVIRONMENTS_TAB } from "@/state/session";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";
import { useTheme } from "@/state/theme";
import { useGit } from "@/state/git";
import { folderName } from "@/state/sources";
import { useWorkspaceActions } from "@/features/workspace/useWorkspaceActions";
import { useCopyAsCurl } from "@/features/curl/useCopyAsCurl";
import { plural } from "@/features/git/model";
import { requestCommitFocus, SOURCE_CONTROL_KBD } from "@/features/git/panelRequests";
import type { Rankable } from "./rank";

export interface PaletteItem extends Rankable {
  /** Unique cmdk value */
  id: string;
  method?: HttpMethod;
  icon?: ReactNode;
  /** send = opened with ⌘↵ */
  run: (send: boolean) => void;
}

function collectRequests(items: TreeNode[], out: SatchelRequest[] = []): SatchelRequest[] {
  for (const node of items) {
    if (node.type === "request") out.push(node.request);
    else collectRequests(node.children, out);
  }
  return out;
}

/** "{{baseUrl}}/v2/products?x=1" → "/v2/products?x=1"; "https://api.dev/health" → "/health" */
export function displayPath(url: string): string {
  const path = url.replace(/^\{\{[^}]+\}\}/, "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  return path || "/";
}

const icon = (Icon: typeof Plus) => <Icon className="size-3.5" strokeWidth={2} />;

/** Every request in the workspace plus the palette's commands, in display order. Only used while the palette is open. */
export function usePaletteItems(): PaletteItem[] {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const actions = useAppActions();
  const wsActions = useWorkspaceActions();
  const copyAsCurl = useCopyAsCurl();
  const { theme, toggleTheme } = useTheme();
  const git = useGit();

  // Thousands of requests: built once per change to the collections, not on every render.
  const collections = ws.workspace.collections;
  const { openTab, send } = session;
  const { setSidebarOpen } = ui;
  const requests = useMemo(
    (): PaletteItem[] =>
      collections.flatMap((collection) =>
        collectRequests(collection.items).map((request) => ({
          id: `req:${request.id}`,
          group: "Requests" as const,
          label: request.name,
          sub: `${collection.name} · ${displayPath(request.url)}`,
          method: request.method,
          run: (sendNow: boolean) => {
            openTab(request.id);
            setSidebarOpen(false);
            if (sendNow) send(request.id);
          },
        })),
      ),
    [collections, openTab, send, setSidebarOpen],
  );

  const active = session.activeTab;
  const activeRequestId = active && active !== ENVIRONMENTS_TAB && ws.findRequest(active) ? active : null;
  const command = (id: string, label: string, sub: string, ic: ReactNode, run: () => void): PaletteItem => ({
    id: `cmd:${id}`,
    group: "Commands",
    label,
    sub,
    icon: ic,
    run,
  });

  // Git: only for a workspace folder, and only what applies to it right now.
  const status = git.status;
  const gitCommands: PaletteItem[] =
    ws.source.kind !== "folder" || !git.available || !git.repo
      ? []
      : !git.repo.isRepo
        ? [command("git-init", "Initialize git repository", "git init", icon(GitBranch), () => void git.init())]
        : [
            command("git-panel", "Source control…", SOURCE_CONTROL_KBD, icon(GitBranch), () => ui.setSourceControlOpen(true)),
            command(
              "git-commit",
              "Git: Commit…",
              git.changes.length ? plural(git.changes.length, "change") : "no changes",
              icon(GitCommitHorizontal),
              () => {
                requestCommitFocus();
                ui.setSourceControlOpen(true);
              },
            ),
            ...(status?.upstream
              ? [
                  command(
                    "git-pull",
                    "Git: Pull",
                    status.behind ? `↓${status.behind} from ${status.upstream}` : status.upstream,
                    icon(ArrowDownToLine),
                    () => void git.pull(),
                  ),
                ]
              : []),
            ...(status?.branch && status.commit
              ? [
                  status.upstream
                    ? command(
                        "git-push",
                        "Git: Push",
                        status.ahead ? `↑${status.ahead} to ${status.upstream}` : status.upstream,
                        icon(ArrowUpFromLine),
                        () => void git.push(),
                      )
                    : command("git-push", "Git: Publish branch", status.branch, icon(ArrowUpFromLine), () => void git.push()),
                ]
              : []),
            command("git-fetch", "Git: Fetch", "download new commits", icon(CloudDownload), () => void git.fetch()),
          ];

  const commands: PaletteItem[] = [
    ...ws.workspace.environments
      .filter((e) => e.id !== ws.workspace.activeEnvironmentId)
      .map((e) => command(`env:${e.id}`, `Switch to ${e.name}`, "environment", <EnvDot color={e.color} />, () => actions.switchEnvironment(e.id))),
    command("new-env", "New environment…", "", icon(Plus), () => ui.openEnvironmentDialog({ mode: "create" })),
    command("postman", "Import Postman collection…", "v2.1", icon(Download), () => ui.openPostmanDialog()),
    command("curl", "Paste cURL from clipboard", "import", icon(SquareTerminal), () => void actions.pasteCurlFromClipboard()),
    command("new-request", "New request", `${MOD}N`, icon(Plus), () => actions.newRequest()),
    command("envs", "Edit environments & globals", "", icon(Layers), () => session.openEnvironments()),
    ...(activeRequestId
      ? [
          command("copy-curl", "Copy request as cURL", "", icon(SquareTerminal), () => copyAsCurl(activeRequestId)),
          command("copy-curl-raw", "Copy request as cURL with {{variables}}", "", icon(SquareTerminal), () =>
            copyAsCurl(activeRequestId, { resolve: false }),
          ),
        ]
      : []),
    command("burst", "Burst-test current request", "rate limit", icon(Zap), () => {
      if (activeRequestId) session.setRequestTab(activeRequestId, "rate");
      else toast("Open a request first, then burst-test it.");
    }),
    command("open-folder", "Open workspace folder…", `${MOD}O`, icon(FolderOpen), () => void wsActions.openFolder()),
    ...ws.recentFolders
      .filter((root) => root !== ws.sourcePath)
      .map((root) => command(`recent:${root}`, `Open ${folderName(root)}`, root, icon(FolderGit2), () => void wsActions.openFolder(root))),
    ...(ws.source.kind === "folder"
      ? [
          command("reload", "Reload workspace from disk", "", icon(RefreshCw), () => void wsActions.reload()),
          command("close-folder", "Close workspace folder", "", icon(FolderX), () => void ws.closeWorkspace()),
        ]
      : [command("save-folder", "Save as workspace folder…", "share with git", icon(Save), () => void wsActions.convertToFolder())]),
    ...gitCommands,
    command("open", "Open .json workspace…", "older format", icon(File), () => void ws.openFile()),
    command(
      "theme",
      `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
      "",
      icon(theme === "dark" ? Sun : Moon),
      toggleTheme,
    ),
    command("first-run", ui.forceFirstRun ? "Leave first-run" : "Show first-run", "onboarding", icon(Sparkles), () =>
      ui.setForceFirstRun(!ui.forceFirstRun),
    ),
  ];

  return [...requests, ...commands];
}
