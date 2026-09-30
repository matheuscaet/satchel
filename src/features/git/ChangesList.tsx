import type { DescribedChange } from "@/git/describe";
import { LinkButton } from "@/components/common/Modal";
import { ChangeRow } from "./ChangeRow";
import { isSelected, sectionChanges, selectionState } from "./model";

interface ChangesListProps {
  changes: DescribedChange[];
  excluded: ReadonlySet<string>;
  /** false while the first status is being read */
  loaded: boolean;
  onToggle: (path: string) => void;
  onToggleAll: () => void;
  onOpen: (change: DescribedChange) => void;
}

/** The changed files, grouped (requests, collections & folders, environments, …), each with a commit checkbox. */
export function ChangesList({ changes, excluded, loaded, onToggle, onToggleAll, onOpen }: ChangesListProps) {
  if (!loaded) return <p className="px-3 py-6 text-center text-[12.5px] text-fg3">Reading the repository…</p>;
  if (changes.length === 0) {
    return <p className="px-6 py-7 text-center text-[12.5px] leading-normal text-fg3">No changes. Everything in this workspace is committed.</p>;
  }
  const state = selectionState(changes, excluded);
  const selectable = changes.some((c) => c.kind !== "conflicted");

  return (
    <div className="pb-1">
      <div className="flex h-8 items-center gap-2 pr-3 pl-3">
        <span className="text-[12px] font-medium text-fg2">Changes</span>
        <span className="font-mono text-[11px] text-fg3">{changes.length}</span>
        <span className="flex-1" />
        {selectable && (
          <LinkButton onClick={onToggleAll} className="text-[11.5px]">
            {state === "all" ? "Select none" : "Select all"}
          </LinkButton>
        )}
      </div>
      {sectionChanges(changes).map((section) => (
        <section key={section.group} aria-label={section.label}>
          <h3 className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-fg3 uppercase">
            {section.label}
            <span className="font-mono font-normal tracking-normal">{section.changes.length}</span>
          </h3>
          <ul>
            {section.changes.map((c) => (
              <ChangeRow key={c.path} change={c} selected={isSelected(c, excluded)} onToggle={() => onToggle(c.path)} onOpen={() => onOpen(c)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
