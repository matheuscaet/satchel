import type { ReactNode } from "react";
import { Download, FolderGit2, Plus, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Kbd, MOD } from "@/components/common/Kbd";
import { BagMark } from "@/features/shell/BagMark";
import { useWorkspace } from "@/state/workspace";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";
import { folderName } from "@/state/sources";
import { useWorkspaceActions } from "@/features/workspace/useWorkspaceActions";

interface DoorProps {
  icon: ReactNode;
  title: string;
  hint: ReactNode;
  kbd?: string;
  onClick: () => void;
}

/** One big entry button on the first-run screen. */
function Door({ icon, title, hint, kbd, onClick }: DoorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line2 bg-bg1 px-3.5 py-3 text-left transition-[border-color,background-color] duration-150 hover:border-brass-line hover:bg-bg2"
    >
      <span className="grid size-[30px] flex-none place-items-center rounded-md bg-bg3 text-fg2">{icon}</span>
      <span className="flex-1">
        <b className="block font-medium">{title}</b>
        <span className="text-[12.5px] text-fg3">{hint}</span>
      </span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

/** Onboarding shown when the workspace is empty (or forced from the palette). */
export function FirstRun() {
  const ui = useUi();
  const actions = useAppActions();

  const leave = (run: () => void) => () => {
    ui.setForceFirstRun(false);
    run();
  };

  return (
    <div className="grid min-h-0 place-items-center overflow-auto px-5 py-8">
      <div className="w-[min(520px,100%)]">
        <div className="mb-3.5 text-brass">
          <BagMark size={34} />
        </div>
        <h1 className="m-0 mb-1.5 text-[20px] font-semibold tracking-[-0.02em]">Start with a request</h1>
        <p className="m-0 mb-5 leading-[1.55] text-fg2">
          Satchel sends HTTP requests and shows you what comes back. No account, and nothing runs in the background.
        </p>

        <Door
          icon={<SquareTerminal className="size-[15px]" strokeWidth={2} />}
          title="Paste a cURL"
          hint={<>From browser devtools: “Copy as cURL”, then {MOD}V anywhere</>}
          kbd={`${MOD}V`}
          onClick={leave(() => void actions.pasteCurlFromClipboard())}
        />
        <Door
          icon={<Download className="size-[15px]" strokeWidth={2} />}
          title="Import a Postman collection"
          hint="v2.1 export (.json). It becomes a regular Satchel collection"
          onClick={leave(() => ui.openPostmanDialog())}
        />
        <Door
          icon={<Plus className="size-[15px]" strokeWidth={2} />}
          title="New empty request"
          hint="GET, a URL, and Send"
          kbd={`${MOD}N`}
          onClick={leave(() => actions.newRequest())}
        />

        <WorkspaceBox />
      </div>
    </div>
  );
}

/** "Where your workspace lives": a folder you can share with git, or the app until you choose. */
function WorkspaceBox() {
  const ws = useWorkspace();
  const actions = useWorkspaceActions();
  const recents = ws.recentFolders.slice(0, 3);
  const linkClass = "cursor-pointer text-fg2 underline decoration-line2 underline-offset-[3px] hover:text-fg hover:decoration-current";

  if (ws.source.kind === "folder") {
    return (
      <div className="mt-5 rounded-lg border border-dashed border-line2 bg-bg0 p-3.5">
        <div className="mb-1 font-medium">Where your workspace lives</div>
        <div className="text-[12.5px] leading-normal text-fg3">
          In <span className="font-mono text-fg2">{ws.sourcePath}</span>: one file per request, ready to commit and share with git.
        </div>
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-lg border border-dashed border-line2 bg-bg0 p-3.5">
      <div className="mb-1 font-medium">Where your workspace lives</div>
      <div className="mb-2.5 text-[12.5px] leading-normal text-fg3">
        In a folder you choose, one plain file per request, so a team can share it through any git repository. Until you pick one, it
        stays in this app.
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => void actions.openFolder()}
          className="h-8 cursor-pointer rounded-md border border-line2 px-3.5 font-medium whitespace-nowrap text-fg2 hover:bg-bg2 hover:text-fg"
        >
          Open folder…
        </button>
        <button type="button" onClick={() => toast("OK. Your work stays in the app until you choose a folder.")} className={linkClass}>
          Decide later
        </button>
      </div>
      {recents.length > 0 && (
        <div className="mt-3 grid gap-1 border-t border-line pt-2.5">
          <div className="text-[11px] text-fg3">Recent</div>
          {recents.map((root) => (
            <button
              key={root}
              type="button"
              title={root}
              onClick={() => void actions.openFolder(root)}
              className="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left hover:bg-bg2"
            >
              <FolderGit2 className="size-3.5 flex-none text-fg3" strokeWidth={1.8} />
              <span className="flex-none text-fg">{folderName(root)}</span>
              <span className="min-w-0 truncate font-mono text-[11.5px] text-fg3">{root}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
