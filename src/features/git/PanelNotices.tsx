import { useState } from "react";
import { ChevronRight, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorSummary, plural } from "./model";

/** git's last error: the first line, the rest behind "Details", selectable so it can be copied. */
export function GitErrorBlock({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const { first, rest } = errorSummary(error);

  return (
    <div role="alert" className="border-b border-line bg-err-soft px-3 py-2">
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-px size-3.5 shrink-0 text-err" strokeWidth={2} />
        <p className="min-w-0 flex-1 font-mono text-[11.5px] leading-normal break-words text-err select-text">{first}</p>
        <button
          type="button"
          aria-label="Dismiss the error"
          onClick={onDismiss}
          className="-mt-0.5 -mr-1 grid size-5 flex-none cursor-pointer place-items-center rounded text-err/80 hover:bg-err-soft hover:text-err"
        >
          <X className="size-3" strokeWidth={2.4} />
        </button>
      </div>
      {rest && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="mt-1 ml-5 flex cursor-pointer items-center gap-0.5 text-[11.5px] text-fg3 hover:text-fg2"
          >
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} strokeWidth={2} />
            {open ? "Hide details" : "Details"}
          </button>
          {open && (
            <pre className="mt-1 ml-5 max-h-40 overflow-auto font-mono text-[11.5px] leading-normal whitespace-pre-wrap text-err select-text">
              {rest}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

export function ConflictBanner({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-2 border-b border-line bg-err-soft px-3 py-2 text-[12px] leading-normal">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-err" strokeWidth={2} />
      <p className="text-fg">
        <span className="font-medium text-err">
          {plural(count, "file")} {count === 1 ? "has a merge conflict" : "have merge conflicts"}.
        </span>{" "}
        <span className="text-fg2">Resolve them in your editor; Satchel reloads them when they're fixed.</span>
      </p>
    </div>
  );
}

/** A merge or rebase is in progress (typically a pull that conflicted). */
export function OperationBanner({ operation }: { operation: "merge" | "rebase" }) {
  return (
    <div className="flex items-start gap-2 border-b border-line bg-brass-soft px-3 py-2 text-[12px] leading-normal">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={2} />
      <p className="text-fg2">
        {operation === "merge" ? (
          <>
            <span className="font-medium text-fg">Merge in progress.</span> Resolve any conflicts, then complete the merge below: it
            commits everything the merge brought in, not just selected files.
          </>
        ) : (
          <>
            <span className="font-medium text-fg">Rebase in progress.</span> Finish it in a terminal (
            <span className="font-mono text-fg">git rebase --continue</span> or <span className="font-mono text-fg">--abort</span>).
          </>
        )}
      </p>
    </div>
  );
}
