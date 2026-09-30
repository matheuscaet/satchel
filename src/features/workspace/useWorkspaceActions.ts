import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWorkspace } from "@/state/workspace";
import { useUi } from "@/state/ui";
import { folderName } from "@/state/sources";

/** Opening, creating and converting workspace folders, with the UI around each outcome. */
export function useWorkspaceActions() {
  const ws = useWorkspace();
  const ui = useUi();

  async function openFolder(root?: string) {
    const result = await ws.openFolder(root);
    if (result.status === "not-workspace") ui.setFolderSetup({ root: result.root });
    else if (result.status === "opened") {
      ui.setForceFirstRun(false);
      const n = result.problems;
      toast(`Opened ${folderName(result.root)}.${n ? ` ${n} file${n === 1 ? " needs" : "s need"} attention.` : ""}`);
    } else if (result.status === "failed" && root && ws.recentFolders.includes(root)) {
      toast.error(`Couldn't open ${folderName(root)}.`, {
        action: { label: "Remove from recents", onClick: () => ws.forgetRecent(root) },
      });
    }
  }

  async function convertToFolder() {
    if (await ws.saveAsFolder()) {
      ui.setForceFirstRun(false);
      toast("Saved as a workspace folder. Commit it to share it with your team.");
    }
  }

  async function reveal() {
    if (!ws.sourcePath) return;
    try {
      await revealItemInDir(ws.sourcePath);
    } catch {
      toast.error("Couldn't open the file manager.");
    }
  }

  async function reload() {
    if (!(await ws.reloadFromDisk())) toast("Already up to date with the folder.");
  }

  return { openFolder, convertToFolder, reveal, reload };
}
