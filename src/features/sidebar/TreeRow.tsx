import { memo, useRef, type ComponentProps, type RefObject } from "react";
import { ChevronRight, Ellipsis, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MethodLabel } from "@/components/common/MethodLabel";
import { MenuContent, MenuItem, MenuSeparator } from "@/features/shell/menu";
import { cn } from "@/lib/utils";
import { RenameInput } from "./RenameInput";
import { ROW_INDENT, ROW_PAD } from "./dropTarget";
import { sameRow, type TreeRowModel } from "./treeRows";

export type RowAction = "new-request" | "new-folder" | "copy-curl" | "copy-curl-raw" | "rename" | "delete";

/** How a row's menu was opened: from the keyboard, focus goes to its first item (as Radix does). */
export type MenuOpening = "pointer" | "keyboard";

/** What rows report back. One object for the whole tree that never changes, so rows can skip re-rendering. */
export interface RowHandlers {
  activate: (row: TreeRowModel) => void;
  menu: (row: TreeRowModel, open: boolean, via?: MenuOpening) => void;
  renameDone: (row: TreeRowModel, name: string | null) => void;
  action: (row: TreeRowModel, action: RowAction) => void;
}

interface TreeRowProps {
  row: TreeRowModel;
  selected: boolean;
  /** The row that takes Tab focus (roving tabindex) */
  tabStop: boolean;
  renaming: boolean;
  /** Set while the row's menu is open */
  menu: MenuOpening | null;
  handlers: RowHandlers;
  /** A drag hovers the middle of this folder/collection: the item would go inside */
  dropInside: boolean;
  /** This row is being dragged */
  dragging: boolean;
  /** Kept mounted outside the tree's rendered window (focused, renaming…): positioned on its own, this many px down */
  pinnedTop?: number;
}

/** One 28px line of the collection tree: collection, folder or request. Re-renders only when its props change. */
export const TreeRow = memo(
  TreeRowView,
  (a, b) =>
    sameRow(a.row, b.row) &&
    a.selected === b.selected &&
    a.tabStop === b.tabStop &&
    a.renaming === b.renaming &&
    a.menu === b.menu &&
    a.handlers === b.handlers &&
    a.dropInside === b.dropInside &&
    a.dragging === b.dragging &&
    a.pinnedTop === b.pinnedTop,
);

function TreeRowView({ row, selected, tabStop, renaming, menu, handlers, dropInside, dragging, pinnedTop }: TreeRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const isRequest = row.kind === "request";
  const name = isRequest ? row.request.name : row.name;
  const paddingLeft = ROW_PAD + row.depth * ROW_INDENT;

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-selected={selected}
      aria-expanded={isRequest ? undefined : row.open}
      data-tree-row=""
      data-row-id={row.id}
      tabIndex={tabStop ? 0 : -1}
      onClick={renaming ? undefined : () => handlers.activate(row)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!renaming) handlers.menu(row, true);
      }}
      style={pinnedTop === undefined ? { paddingLeft } : { paddingLeft, position: "absolute", top: pinnedTop, left: 0, right: 0 }}
      className={cn(
        "group relative flex h-7 cursor-pointer items-center gap-1.5 pr-1.5 whitespace-nowrap text-fg2 select-none hover:bg-bg2 hover:text-fg focus-visible:[outline-offset:-1.5px]",
        selected &&
          "bg-bg3 text-fg hover:bg-bg3 before:absolute before:top-[5px] before:bottom-[5px] before:left-0 before:w-0.5 before:rounded-[2px] before:bg-brass",
        dropInside && "bg-brass-soft text-fg shadow-[inset_0_0_0_1px_var(--brass)] hover:bg-brass-soft",
        dragging && "opacity-45",
      )}
    >
      {isRequest ? (
        <MethodLabel method={row.request.method} short className="w-[38px] text-left" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "grid size-3 flex-none place-items-center text-fg3 transition-transform duration-150 ease-out",
            row.open && "rotate-90",
          )}
        >
          <ChevronRight className="size-2.5" strokeWidth={2.8} />
        </span>
      )}

      {renaming ? (
        <RenameInput initial={name} onDone={(value) => handlers.renameDone(row, value)} />
      ) : (
        <span className={cn("min-w-0 flex-1 truncate", row.kind === "collection" && "font-medium text-fg")}>{name}</span>
      )}

      {row.kind === "collection" && !renaming && <span className="text-[11px] text-fg3">{row.count}</span>}

      {!renaming &&
        // Radix's menu (root, trigger, portal…) is mounted only while it's open: thousands of idle
        // menus made every tree render slow. Closed, the button looks and announces the same.
        (menu ? (
          <RowMenu row={row} via={menu} rowRef={rowRef} handlers={handlers} />
        ) : (
          <MenuButton
            isRequest={isRequest}
            aria-haspopup="menu"
            aria-expanded={false}
            data-state="closed"
            // Like Radix's trigger: pressing it doesn't move focus to it.
            onPointerDown={(e) => {
              if (e.button === 0 && !e.ctrlKey) e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!e.ctrlKey) handlers.menu(row, true);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowDown") return;
              e.preventDefault();
              handlers.menu(row, true, "keyboard");
            }}
          />
        ))}
    </div>
  );
}

/** The row's trailing button: "…" on requests, "+" on folders and collections. */
function MenuButton({ isRequest, className, ...props }: ComponentProps<"button"> & { isRequest: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={isRequest ? "More" : "Add"}
      className={cn(
        "grid size-5 flex-none cursor-pointer place-items-center rounded-sm text-fg3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-bg3 hover:text-fg data-[state=open]:bg-bg3 data-[state=open]:text-fg data-[state=open]:opacity-100",
        className,
      )}
      {...props}
    >
      {isRequest ? <Ellipsis className="size-[13px]" strokeWidth={2.4} /> : <Plus className="size-[13px]" strokeWidth={2.2} />}
    </button>
  );
}

interface RowMenuProps {
  row: TreeRowModel;
  via: MenuOpening;
  rowRef: RefObject<HTMLDivElement | null>;
  handlers: RowHandlers;
}

/** The open row menu. Closing it unmounts it, and focus goes back to the row (not the button). */
function RowMenu({ row, via, rowRef, handlers }: RowMenuProps) {
  // Set when the menu closes because of a choice or an outside click: then focus shouldn't jump back to the row.
  const skipRefocus = useRef(false);
  const entered = useRef(false);
  const isRequest = row.kind === "request";

  const choose = (action: RowAction) => {
    skipRefocus.current = true;
    handlers.action(row, action);
  };

  return (
    <DropdownMenu open onOpenChange={(open) => handlers.menu(row, open)}>
      <DropdownMenuTrigger asChild>
        <MenuButton isRequest={isRequest} onClick={(e) => e.stopPropagation()} />
      </DropdownMenuTrigger>
      <MenuContent
        align="start"
        // React events bubble through portals: keep menu clicks from activating the row.
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onFocus={(e) => {
          // Radix moves focus to the first item only for a keypress it saw, and the menu wasn't
          // mounted yet when this one opened it: do it here, when Radix first focuses the menu.
          if (via !== "keyboard" || entered.current || e.target !== e.currentTarget) return;
          entered.current = true;
          e.preventDefault();
          e.currentTarget.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
        }}
        onInteractOutside={() => {
          skipRefocus.current = true;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (!skipRefocus.current) rowRef.current?.focus();
          skipRefocus.current = false;
        }}
      >
        {!isRequest && (
          <>
            <MenuItem onSelect={() => choose("new-request")}>New request here</MenuItem>
            <MenuItem onSelect={() => choose("new-folder")}>New folder here</MenuItem>
            <MenuSeparator />
          </>
        )}
        {isRequest && (
          <>
            <MenuItem onSelect={() => choose("copy-curl")}>Copy as cURL</MenuItem>
            <MenuItem onSelect={() => choose("copy-curl-raw")}>{"Copy as cURL (with {{variables}})"}</MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem sub="F2" onSelect={() => choose("rename")}>
          Rename
        </MenuItem>
        <MenuItem danger onSelect={() => choose("delete")}>
          Delete
        </MenuItem>
      </MenuContent>
    </DropdownMenu>
  );
}
