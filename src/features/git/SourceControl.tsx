import { useEffect, useRef, useState } from "react";
import type { DescribedChange } from "@/git/describe";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGit } from "@/state/git";
import { useUi } from "@/state/ui";
import { useSessionCore } from "@/state/session";
import { useWorkspace } from "@/state/workspace";
import { ChangesList } from "./ChangesList";
import { CommitBox, type CommitRun } from "./CommitBox";
import { GitStatusChip } from "./GitStatusChip";
import { PanelHeader } from "./PanelHeader";
import { ConflictBanner, GitErrorBlock, OperationBanner } from "./PanelNotices";
import { selectedPaths, toggleAll, toggleOne } from "./model";
import { SOURCE_CONTROL_KBD, takeCommitFocus } from "./panelRequests";

/**
 * The header's git chip and its source control panel. Shown only for a
 * workspace folder that's a git repository. Nothing runs on its own: every
 * commit, pull, push and fetch is a click here (or a palette command).
 */
export function SourceControl() {
  const ws = useWorkspace();
  const git = useGit();
  const ui = useUi();
  const session = useSessionCore();

  // Kept here (not in the popover content) so a draft survives closing the panel.
  const [message, setMessage] = useState("");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [running, setRunning] = useState<CommitRun | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const shown = ws.source.kind === "folder" && git.available === true && git.repo?.isRepo === true;

  // Don't leave the panel "open" for a folder that has no chip (it would pop up when one appears).
  const closeRef = useRef(ui.setSourceControlOpen);
  closeRef.current = ui.setSourceControlOpen;
  useEffect(() => {
    if (!shown) return;
    return () => closeRef.current(false);
  }, [shown]);

  if (!shown) return null;

  const { status, changes, conflicts, busy } = git;
  const paths = selectedPaths(changes, excluded);
  const open = ui.sourceControlOpen;
  const setOpen = ui.setSourceControlOpen;

  const merging = git.operation === "merge";
  const commit = async (andPush: boolean) => {
    const text = message.trim();
    if (busy || (!merging && (!text || paths.length === 0))) return;
    setRunning(andPush ? "commit-push" : "commit");
    try {
      if (!(await git.commit(text, paths))) return;
      setMessage("");
      if (andPush) await git.push();
    } finally {
      setRunning(null);
    }
  };

  const openChange = (c: DescribedChange) => {
    if (!c.entityId) return;
    if (c.group === "environments") session.openEnvironments();
    else session.openTab(c.entityId);
    ui.setSidebarOpen(false);
    setOpen(false);
  };

  const error = git.lastError;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <GitStatusChip status={status} changes={changes.length} conflicts={conflicts} />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4} className="px-2 py-1 text-[11.5px]">
          Source control<span className="ml-1.5 opacity-60">{SOURCE_CONTROL_KBD}</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-label="Source control"
        onOpenAutoFocus={(e) => {
          if (!takeCommitFocus()) return;
          e.preventDefault();
          messageRef.current?.focus();
          requestAnimationFrame(() => messageRef.current?.focus());
        }}
        className="flex max-h-[min(70vh,var(--radix-popover-content-available-height))] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border-0 bg-bg1 p-0 text-[13px] text-fg shadow-pop"
      >
        <PanelHeader
          status={status}
          busy={busy}
          refreshing={git.refreshing}
          onRefresh={() => void git.refresh()}
          onFetch={() => void git.fetch()}
          onPull={() => void git.pull()}
          onPush={() => void git.push()}
        />
        {error && <GitErrorBlock key={error} error={error} onDismiss={git.clearError} />}
        {git.operation && <OperationBanner operation={git.operation} />}
        {conflicts > 0 && <ConflictBanner count={conflicts} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChangesList
            changes={changes}
            excluded={excluded}
            loaded={status !== null}
            onToggle={(path) => setExcluded((ex) => toggleOne(ex, path))}
            onToggleAll={() => setExcluded((ex) => toggleAll(changes, ex))}
            onOpen={openChange}
          />
        </div>
        {(changes.length > 0 || merging) && (
          <CommitBox
            merging={merging}
            ref={messageRef}
            message={message}
            onMessage={setMessage}
            count={paths.length}
            locked={busy !== null}
            running={running}
            onCommit={(andPush) => void commit(andPush)}
          />
        )}
        <p className="border-t border-line px-3 py-1.5 text-[11.5px] text-fg3">Nothing is committed or pushed until you click.</p>
      </PopoverContent>
    </Popover>
  );
}
