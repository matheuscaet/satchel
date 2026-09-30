import { File, FolderGit2, FolderOpen } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MOD } from "@/components/common/Kbd";
import { useWorkspace, type SaveState } from "@/state/workspace";
import { useUi } from "@/state/ui";
import { folderName } from "@/state/sources";
import { cn } from "@/lib/utils";
import { ProblemsButton } from "@/features/workspace/ProblemsButton";
import { useWorkspaceActions } from "@/features/workspace/useWorkspaceActions";
import { GitMenuItems } from "@/features/git/GitMenuItems";
import { SourceControl } from "@/features/git/SourceControl";
import { MenuContent, MenuHead, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from "./menu";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  cache: "Not saved yet",
  error: "Couldn't save",
};

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className="flex items-center gap-[5px] text-[11.5px] whitespace-nowrap text-fg3">
      <i
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-ok transition-colors duration-200",
          state === "saving" && "animate-[pulse_.8s_ease-in-out_infinite] bg-brass",
          state === "cache" && "bg-fg3",
          state === "error" && "bg-err",
        )}
      />
      <span className="max-[820px]:hidden">{SAVE_LABEL[state]}</span>
    </span>
  );
}

/** Header button: where the workspace lives (folder, legacy file, or the app cache) + save state; opens the workspace menu. */
export function WorkspaceFileMenu() {
  const ws = useWorkspace();
  const ui = useUi();
  const actions = useWorkspaceActions();
  const kind = ws.source.kind;
  const Icon = kind === "folder" ? FolderGit2 : File;
  const recents = ws.recentFolders.filter((r) => r !== ws.sourcePath);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={ws.sourcePath ?? "Workspace"}
            className="flex h-7 min-w-0 cursor-pointer items-center gap-[7px] rounded-md px-2 text-fg2 outline-none hover:bg-bg2 hover:text-fg focus-visible:outline-[1.5px] focus-visible:outline-brass data-[state=open]:bg-bg2 data-[state=open]:text-fg"
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate font-mono text-xs max-[820px]:hidden">{ws.sourceName ?? "Untitled workspace"}</span>
            <SaveIndicator state={ws.saveState} />
          </button>
        </DropdownMenuTrigger>
        <MenuContent
          align="start"
          className="max-w-[min(480px,calc(100vw-16px))]"
          // "Source control…" opens a popover: handing focus back to this trigger would close it again.
          onCloseAutoFocus={(e) => ui.sourceControlOpen && e.preventDefault()}
        >
          <MenuHead className="truncate" title={ws.sourcePath ?? undefined}>
            {ws.sourcePath ?? "Not saved yet · kept in the app"}
          </MenuHead>
          <MenuItem onSelect={() => void actions.openFolder()} kbd={`${MOD}O`}>
            Open folder…
          </MenuItem>
          {recents.length > 0 && (
            <MenuSub>
              <MenuSubTrigger>Open recent</MenuSubTrigger>
              <MenuSubContent className="max-w-[min(420px,calc(100vw-16px))]">
                {recents.map((root) => (
                  <MenuItem key={root} onSelect={() => void actions.openFolder(root)} title={root} sub={<span className="block max-w-[220px] truncate font-mono">{root}</span>}>
                    <FolderOpen className="size-3.5 text-fg3" strokeWidth={1.8} />
                    {folderName(root)}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem onSelect={() => recents.forEach((r) => ws.forgetRecent(r))}>Clear recent folders</MenuItem>
              </MenuSubContent>
            </MenuSub>
          )}
          {kind !== "folder" && (
            <MenuItem onSelect={() => void actions.convertToFolder()} sub="to share it with git">
              Save as workspace folder…
            </MenuItem>
          )}
          {kind === "folder" && (
            <>
              <MenuItem onSelect={() => void actions.reload()}>Reload from disk</MenuItem>
              <MenuItem onSelect={() => void actions.reveal()}>Reveal in file manager</MenuItem>
            </>
          )}
          <GitMenuItems />
          <MenuSeparator />
          <MenuItem onSelect={() => ui.openPostmanDialog()}>Import Postman collection…</MenuItem>
          <MenuItem onSelect={() => void ws.openFile()} sub="older format">
            Open .json workspace…
          </MenuItem>
          {kind !== "cache" && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => void ws.closeWorkspace()}>Close {kind === "folder" ? "folder" : "file"}</MenuItem>
            </>
          )}
        </MenuContent>
      </DropdownMenu>
      <ProblemsButton className="max-[820px]:hidden" />
      <SourceControl />
    </div>
  );
}
