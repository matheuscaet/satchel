import type { MouseEvent } from "react";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import type { DescribedChange } from "@/git/describe";
import { Checkmark } from "@/components/common/Checkmark";
import { MethodLabel } from "@/components/common/MethodLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { canOpen, canSelect, KIND_BADGE, renamedFrom, splitTitle } from "./model";

const TIP = "px-2 py-1 text-[11.5px]";

function StatusBadge({ kind }: { kind: DescribedChange["kind"] }) {
  const badge = KIND_BADGE[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={badge.label}
          className={cn("w-2.5 shrink-0 cursor-default text-center font-mono text-[11px] leading-none font-semibold", badge.className)}
        >
          {badge.letter}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6} className={TIP}>
        {badge.label}
      </TooltipContent>
    </Tooltip>
  );
}

interface ChangeRowProps {
  change: DescribedChange;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

/** One changed file: include-in-commit checkbox, status letter, method, name (trail in fg3), open on hover. */
export function ChangeRow({ change, selected, onToggle, onOpen }: ChangeRowProps) {
  const selectable = canSelect(change);
  const { leaf, trail } = splitTitle(change.title);
  const from = renamedFrom(change);
  const openable = canOpen(change);
  const onRowClick = (e: MouseEvent) => {
    if (selectable && !(e.target as HTMLElement).closest("button")) onToggle();
  };

  return (
    <li
      title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}
      onClick={onRowClick}
      className={cn("group flex h-[27px] items-center gap-2 pr-1 pl-3 hover:bg-bg2", selectable && "cursor-pointer")}
    >
      {selectable ? (
        <Checkmark checked={selected} onChange={onToggle} label={`Include ${change.title} in the commit`} />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="grid size-3.5 shrink-0 place-items-center text-err" aria-label="Resolve the conflict to commit this file">
              <CircleAlert className="size-3.5" strokeWidth={2} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6} className={TIP}>
            Resolve the conflict to commit this file
          </TooltipContent>
        </Tooltip>
      )}
      <StatusBadge kind={change.kind} />
      {change.method ? (
        <MethodLabel method={change.method} short className="w-[30px]" />
      ) : (
        change.group === "requests" && <span aria-hidden className="w-[30px] shrink-0" /> // a deleted request: keep names aligned
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(change.kind === "deleted" ? "text-fg2 line-through decoration-fg3/60" : "text-fg")}>{leaf}</span>
        {trail && <span className="ml-1.5 text-[12px] text-fg3">{trail}</span>}
        {from && <span className="ml-1.5 text-[12px] text-fg3">from {from}</span>}
      </span>
      {openable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpen}
              aria-label={change.group === "environments" ? "Open environments" : `Open ${leaf}`}
              className="grid size-6 flex-none cursor-pointer place-items-center rounded-md text-fg3 opacity-0 group-hover:opacity-100 hover:bg-bg3 hover:text-fg focus-visible:opacity-100"
            >
              <ArrowUpRight className="size-3.5" strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4} className={TIP}>
            {change.group === "environments" ? "Open environments" : "Open request"}
          </TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}
