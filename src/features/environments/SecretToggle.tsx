import { Lock, LockOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SecretToggleProps {
  name: string;
  secret: boolean;
  onToggle: () => void;
}

/** The lock in a matrix row's name cell: always shown when secret, on row hover otherwise. */
export function SecretToggle({ name, secret, onToggle }: SecretToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={secret ? `Share the values of ${name}` : `Mark ${name} as secret`}
          aria-pressed={secret}
          onClick={onToggle}
          className={cn(
            "ml-auto grid size-5 flex-none cursor-pointer place-items-center rounded-sm hover:bg-bg3 hover:text-fg focus-visible:opacity-100",
            secret ? "text-fg2" : "text-fg3 opacity-0 group-hover/row:opacity-100",
          )}
        >
          {secret ? <Lock className="size-3" strokeWidth={2.2} /> : <LockOpen className="size-3" strokeWidth={2.2} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={4} className="max-w-[260px] px-2 py-1 font-sans text-[11.5px]">
        {secret
          ? "Secret — values stay on this machine. Click to share values again"
          : "Mark as secret — its values stay on this machine and out of shared workspace files"}
      </TooltipContent>
    </Tooltip>
  );
}
