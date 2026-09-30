import type { ComponentProps, ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CloudDownload, GitBranch, LoaderCircle, RotateCw, type LucideIcon } from "lucide-react";
import type { GitOperation } from "@/state/git";
import type { GitStatus } from "@/git/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolbarButton } from "@/features/response/viewer/ToolbarButton";
import { cn } from "@/lib/utils";
import { branchLabel, plural } from "./model";

const TIP = "max-w-[260px] px-2 py-1 text-[11.5px]";

interface SyncButtonProps extends Omit<ComponentProps<"button">, "disabled"> {
  icon: LucideIcon;
  running: boolean;
  /** disabled, but still hoverable so the tooltip can say why */
  blocked: boolean;
  /** brass-tinted: there's something to pull / push */
  pending: boolean;
  tip: ReactNode;
}

function SyncButton({ icon: Icon, running, blocked, pending, tip, children, onClick, className, ...props }: SyncButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled={blocked}
          onClick={blocked ? undefined : onClick}
          className={cn(
            "flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border border-line2 px-2 text-[12px] font-medium whitespace-nowrap text-fg2 hover:bg-bg2 hover:text-fg",
            pending && "border-brass-line text-fg",
            blocked && "cursor-default opacity-40 hover:bg-transparent hover:text-fg2",
            className,
          )}
          {...props}
        >
          {running ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2} /> : <Icon className="size-3.5" strokeWidth={2} />}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4} className={TIP}>
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

interface PanelHeaderProps {
  status: GitStatus | null;
  busy: GitOperation | null;
  refreshing: boolean;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
}

/** Branch and upstream, then Refresh · Fetch · Pull ↓n · Push ↑n (or Publish branch). */
export function PanelHeader({ status, busy, refreshing, onRefresh, onFetch, onPull, onPush }: PanelHeaderProps) {
  const detached = status !== null && status.branch === null;
  const upstream = status?.upstream ?? null;
  const noCommits = status !== null && status.commit === null;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const locked = busy !== null || status === null;

  const pullBlocked = locked || detached || !upstream;
  const pullTip = detached
    ? "HEAD is detached: check out a branch to pull."
    : !upstream
      ? "This branch isn't published yet, so there's nothing to pull."
      : behind
        ? `Pull ${plural(behind, "commit")} from ${upstream}`
        : `Pull from ${upstream}`;

  const pushBlocked = locked || detached || noCommits;
  const pushTip = detached
    ? "HEAD is detached: check out a branch to push."
    : noCommits
      ? "Commit something first."
      : !upstream
        ? "Push this branch and track it on the remote"
        : ahead
          ? `Push ${plural(ahead, "commit")} to ${upstream}`
          : `Push to ${upstream}`;

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-line py-2 pr-2 pl-3">
      <div className="min-w-0 flex-[1_1_120px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3.5 shrink-0 text-fg3" strokeWidth={1.8} />
          <span className="truncate font-mono text-[12.5px] font-medium text-fg">{status ? branchLabel(status) : "…"}</span>
        </div>
        <div className="mt-0.5 truncate pl-5 font-mono text-[11px] text-fg3">
          {status === null ? " " : detached ? "detached HEAD" : upstream ? `→ ${upstream}` : "not published"}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <ToolbarButton label="Refresh status" onClick={onRefresh} disabled={refreshing || busy !== null}>
          <RotateCw className={cn(refreshing && "animate-spin")} strokeWidth={2} />
        </ToolbarButton>
        <ToolbarButton label="Fetch" hint="download new commits, change nothing" onClick={onFetch} disabled={locked}>
          {busy === "fetch" ? <LoaderCircle className="animate-spin" strokeWidth={2} /> : <CloudDownload strokeWidth={2} />}
        </ToolbarButton>
        <SyncButton icon={ArrowDownToLine} running={busy === "pull"} blocked={pullBlocked} pending={behind > 0} tip={pullTip} onClick={onPull}>
          Pull
          {behind > 0 && <span className="font-mono text-[11px] text-fg3">↓{behind}</span>}
        </SyncButton>
        <SyncButton
          icon={ArrowUpFromLine}
          running={busy === "push"}
          blocked={pushBlocked}
          pending={ahead > 0 || (!upstream && !detached && !noCommits)}
          tip={pushTip}
          onClick={onPush}
        >
          {upstream || detached ? "Push" : "Publish branch"}
          {upstream && ahead > 0 && <span className="font-mono text-[11px] text-fg3">↑{ahead}</span>}
        </SyncButton>
      </div>
    </div>
  );
}
