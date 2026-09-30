import { useState } from "react";
import { toast } from "sonner";
import { Hint, Modal, ModalBody, ModalFooter, PrimaryButton, SecondaryButton } from "@/components/common/Modal";
import { useWorkspace } from "@/state/workspace";
import { useUi } from "@/state/ui";
import { folderName } from "@/state/sources";
import { cn } from "@/lib/utils";

type Start = "empty" | "current";

/** "This folder isn't a Satchel workspace yet": create one there, empty or with what's open now. */
export function FolderSetupDialog() {
  const ui = useUi();
  const setup = ui.folderSetup;
  if (!setup) return null;
  return <FolderSetup key={setup.root} root={setup.root} onClose={() => ui.setFolderSetup(null)} />;
}

function FolderSetup({ root, onClose }: { root: string; onClose: () => void }) {
  const ws = useWorkspace();
  const ui = useUi();
  const hasContent = ws.workspace.collections.length > 0 || ws.workspace.environments.length > 0;
  const [start, setStart] = useState<Start>(hasContent ? "current" : "empty");
  const [busy, setBusy] = useState(false);
  const name = folderName(root);

  async function create() {
    setBusy(true);
    const ok = await ws.createFolderWorkspace(root, start);
    setBusy(false);
    if (!ok) return;
    onClose();
    ui.setForceFirstRun(false);
    toast(`${name} is a Satchel workspace now. Commit it to share it with your team.`);
  }

  return (
    <Modal title={`Make ${name} a workspace?`} size="sm" onClose={onClose}>
      <ModalBody>
        <Hint className="text-[12.5px]">
          <span className="font-mono text-fg2">{root}</span> doesn't have a <span className="font-mono">satchel.json</span> yet. Satchel
          will add <span className="font-mono">satchel.json</span>, <span className="font-mono">collections/</span>,{" "}
          <span className="font-mono">environments/</span> and a <span className="font-mono">.satchel/</span> folder for your personal
          settings, which git ignores. Nothing else in the folder is touched.
        </Hint>
        <div role="radiogroup" aria-label="Start with" className="grid gap-2">
          <Choice
            checked={start === "current"}
            disabled={!hasContent}
            onSelect={() => setStart("current")}
            title="Move what's open now into it"
            hint={
              hasContent
                ? `${ws.workspace.collections.length} collection${ws.workspace.collections.length === 1 ? "" : "s"} and ${ws.workspace.environments.length} environment${ws.workspace.environments.length === 1 ? "" : "s"}${ws.sourceName ? ` from ${ws.sourceName}` : ""}`
                : "Nothing is open right now"
            }
          />
          <Choice checked={start === "empty"} onSelect={() => setStart("empty")} title="Start empty" hint="A new workspace with no requests yet" />
        </div>
      </ModalBody>
      <ModalFooter hint="Nothing is committed: you decide when to commit and push.">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={busy} onClick={() => void create()}>
          Create workspace
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

interface ChoiceProps {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}

function Choice({ checked, disabled, onSelect, title, hint }: ChoiceProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-line2 bg-bg1 px-3 py-2.5 text-left transition-colors hover:bg-bg2 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-bg1",
        checked && "border-brass-line bg-brass-soft hover:bg-brass-soft",
      )}
    >
      <span
        aria-hidden
        className={cn("mt-[3px] grid size-3.5 flex-none place-items-center rounded-full border border-line2", checked && "border-brass")}
      >
        {checked && <span className="size-1.5 rounded-full bg-brass" />}
      </span>
      <span className="grid gap-0.5">
        <span className="font-medium text-fg">{title}</span>
        <span className="text-[12px] text-fg3">{hint}</span>
      </span>
    </button>
  );
}
