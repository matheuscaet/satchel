import { forwardRef, type ComponentProps } from "react";
import { CircleAlert, GitBranch } from "lucide-react";
import type { GitStatus } from "@/git/status";
import { cn } from "@/lib/utils";
import { aheadBehind, branchLabel } from "./model";

interface GitStatusChipProps extends ComponentProps<"button"> {
  status: GitStatus | null;
  changes: number;
  conflicts: number;
}

/** Header chip: branch, pending changes, ahead/behind. Opens the source control panel (it's the popover trigger). */
export const GitStatusChip = forwardRef<HTMLButtonElement, GitStatusChipProps>(function GitStatusChip(
  { status, changes, conflicts, className, ...props },
  ref,
) {
  const sync = status ? aheadBehind(status) : "";
  const detached = status !== null && status.branch === null;

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Source control"
      className={cn(
        "flex h-7 min-w-0 flex-none cursor-pointer items-center gap-1.5 rounded-md px-2 text-fg2 outline-none hover:bg-bg2 hover:text-fg focus-visible:outline-[1.5px] focus-visible:outline-brass data-[state=open]:bg-bg2 data-[state=open]:text-fg",
        className,
      )}
      {...props}
    >
      <GitBranch className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className={cn("max-w-[140px] truncate font-mono text-xs max-[820px]:hidden", detached && "text-fg3")}>
        {status ? branchLabel(status) : "…"}
      </span>
      {conflicts > 0 ? (
        <span className="flex h-4 items-center gap-0.5 rounded-full bg-err-soft pr-1.5 pl-1 font-mono text-[10.5px] leading-none font-medium text-err">
          <CircleAlert className="size-2.5" strokeWidth={2.4} />
          {changes}
        </span>
      ) : (
        changes > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-bg3 px-1.5 font-mono text-[10.5px] leading-none font-medium text-fg2">
            {changes}
          </span>
        )
      )}
      {sync && <span className="font-mono text-[11px] whitespace-nowrap text-fg3">{sync}</span>}
    </button>
  );
});
