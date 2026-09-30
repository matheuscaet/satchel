import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { displayValue } from "./matrixModel";

export const MATRIX_CELL_CLASS = "h-8 border-r border-b border-line px-2.5 text-left align-middle whitespace-nowrap";
/** Sticky first column: opaque so scrolled cells never show through it. */
export const MATRIX_STICKY_CLASS = "sticky left-0 z-[1] min-w-[150px] border-l border-line bg-bg1 text-fg";

interface MatrixCellProps {
  name: string;
  columnKey: string;
  columnLabel: string;
  value: string | undefined;
  /** width in ch */
  width: number;
  active: boolean;
  /** the active environment defines it: this is the value that gets sent */
  winning: boolean;
  ring: "hit" | "fresh" | null;
  /** masked (fixed dots) until focused */
  secret: boolean;
  onCommit: (draft: string) => void;
}

/**
 * One editable value: a bare mono input, committed on blur / Enter, reverted on Escape.
 * A secret value shows as a fixed mask until the cell is focused.
 */
export function MatrixCell({ name, columnKey, columnLabel, value, width, active, winning, ring, secret, onCommit }: MatrixCellProps) {
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const focused = useRef(false);
  const skipCommit = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const masked = displayValue(draft, secret, editing) !== draft;

  // Revealing swaps the input's text, which drops any selection: select the real value instead.
  useLayoutEffect(() => {
    if (editing && secret && document.activeElement === inputRef.current) inputRef.current?.select();
  }, [editing, secret]);

  // Follow outside changes (undo, another cell, a different file) unless the user is typing here.
  useEffect(() => {
    if (!focused.current) setDraft(value ?? "");
  }, [value]);

  return (
    <td
      className={cn(
        MATRIX_CELL_CLASS,
        active && "bg-brass-soft",
        ring === "hit" && "shadow-[inset_0_0_0_1.5px_var(--err)]",
        ring === "fresh" && "shadow-[inset_0_0_0_1.5px_var(--brass-line)]",
      )}
    >
      <input
        ref={inputRef}
        data-cell={`${columnKey}|${name}`}
        value={displayValue(draft, secret, editing)}
        readOnly={masked}
        placeholder="—"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${name} in ${columnLabel}${secret ? " (secret)" : ""}`}
        style={{ width: `${width}ch` }}
        className={cn(
          "block h-[31px] min-w-[8ch] bg-transparent font-mono text-[12.5px] leading-[31px] text-fg2 outline-none placeholder:text-fg3 placeholder:opacity-50 focus:text-fg",
          winning && "text-fg",
        )}
        onFocus={() => {
          focused.current = true;
          setEditing(true);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          setEditing(false);
          if (skipCommit.current) {
            skipCommit.current = false;
            setDraft(value ?? "");
            return;
          }
          onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            skipCommit.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    </td>
  );
}
