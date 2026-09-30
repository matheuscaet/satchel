import { GitBranch } from "lucide-react";
import { useGit } from "@/state/git";
import { useUi } from "@/state/ui";
import { useWorkspace } from "@/state/workspace";
import { MenuItem, MenuSeparator } from "@/features/shell/menu";
import { SOURCE_CONTROL_KBD } from "./panelRequests";

/** Workspace menu entries for git: "Source control…", "Initialize git repository", or a disabled "Git not found". */
export function GitMenuItems() {
  const ws = useWorkspace();
  const git = useGit();
  const ui = useUi();
  if (ws.source.kind !== "folder") return null;

  let item;
  if (git.available === false) {
    item = (
      <MenuItem disabled sub={<span className="block max-w-[240px] truncate">{git.unavailableReason ?? "git isn't installed"}</span>}>
        Git not found
      </MenuItem>
    );
  } else if (git.repo?.isRepo) {
    item = (
      <MenuItem onSelect={() => ui.setSourceControlOpen(true)} kbd={SOURCE_CONTROL_KBD}>
        <GitBranch className="size-3.5" strokeWidth={1.8} />
        Source control…
      </MenuItem>
    );
  } else if (git.repo) {
    item = (
      <MenuItem onSelect={() => void git.init()} disabled={git.busy !== null} sub="to share it">
        Initialize git repository
      </MenuItem>
    );
  } else {
    return null;
  }

  return (
    <>
      <MenuSeparator />
      {item}
    </>
  );
}
