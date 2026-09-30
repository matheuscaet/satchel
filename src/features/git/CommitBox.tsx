import { forwardRef, type KeyboardEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Kbd, MOD } from "@/components/common/Kbd";
import { PrimaryButton, SecondaryButton } from "@/components/common/Modal";
import { cn } from "@/lib/utils";
import { commitLabel } from "./model";

export type CommitRun = "commit" | "commit-push";

interface CommitBoxProps {
  message: string;
  onMessage: (message: string) => void;
  /** files selected for the commit */
  count: number;
  /** another git operation is running */
  locked: boolean;
  running: CommitRun | null;
  onCommit: (andPush: boolean) => void;
  /** a merge is in progress: the button completes it (everything is committed, the message is optional) */
  merging?: boolean;
}

const Spinner = () => <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2} />;

/** Commit message (⌘↵ commits) and Commit / Commit & Push. */
export const CommitBox = forwardRef<HTMLTextAreaElement, CommitBoxProps>(function CommitBox(
  { message, onMessage, count, locked, running, onCommit, merging = false },
  ref,
) {
  const ready = merging ? !locked : message.trim() !== "" && count > 0 && !locked;
  const rows = Math.min(4, Math.max(2, message.split("\n").length));
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (ready) onCommit(false);
    }
  };

  return (
    <div className="grid gap-2 border-t border-line px-3 pt-2.5 pb-2">
      <textarea
        ref={ref}
        rows={rows}
        value={message}
        spellCheck
        aria-label="Commit message"
        placeholder={merging ? "Merge message (optional: git's default is used)" : "Commit message (e.g. Add the orders endpoints)"}
        onChange={(e) => onMessage(e.target.value)}
        onKeyDown={onKeyDown}
        className="block w-full min-w-0 resize-none rounded-md border border-line2 bg-bg0 px-2.5 py-1.5 text-[13px] leading-[1.45] text-fg outline-none placeholder:text-fg3 focus:border-brass-line"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto flex items-center gap-1 text-[11.5px] text-fg3 max-[400px]:hidden">
          <Kbd>{`${MOD}↵`}</Kbd> to commit
        </span>
        <SecondaryButton
          disabled={!ready}
          onClick={() => onCommit(true)}
          className={cn(
            "flex h-7 items-center gap-1.5 px-2.5 text-[12.5px]",
            "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg2",
          )}
        >
          {running === "commit-push" && <Spinner />}
          {merging ? "Complete & Push" : "Commit & Push"}
        </SecondaryButton>
        <PrimaryButton disabled={!ready} onClick={() => onCommit(false)} className="flex h-7 items-center gap-1.5 px-3 text-[12.5px]">
          {running === "commit" && <Spinner />}
          {merging ? "Complete merge" : commitLabel(count)}
        </PrimaryButton>
      </div>
    </div>
  );
});
