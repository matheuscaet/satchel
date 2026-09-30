import { useState } from "react";
import { ChevronsDownUp, Layers, Search } from "lucide-react";
import { toast } from "sonner";
import { countRequests } from "@/collectionTree";
import type { TreeNode } from "@/types";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi } from "@/state/ui";
import { cn } from "@/lib/utils";
import { CollectionTree } from "./CollectionTree";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { NewMenu } from "./NewMenu";
import { SidebarResizer } from "./SidebarResizer";
import { IconButton } from "@/features/shell/IconButton";
import { variableNameCount, type TreeRowModel } from "./treeRows";

/**
 * The tree's scroller: a thin token-colored scrollbar in a reserved gutter, so it never covers the
 * rows' trailing "…"/"+" buttons (WebKitGTK/macOS would otherwise overlay it on top of them).
 * Standard properties for Firefox/Chromium ≥121 (WebView2); ::-webkit-scrollbar for WebKit, where
 * styling it also turns an overlay scrollbar into a classic one that takes its own space.
 */
const TREE_SCROLL =
  "[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--line2)_transparent] " +
  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-line2 [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-thumb:hover]:bg-fg3";

type PendingDelete = { kind: "collection" | "folder"; collectionId: string; id: string; name: string; count: number };

function findFolderChildren(items: TreeNode[], id: string): TreeNode[] | undefined {
  for (const node of items) {
    if (node.type !== "folder") continue;
    if (node.id === id) return node.children;
    const found = findFolderChildren(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/** Left column: filter, "+" menu, collection tree, environments shortcut. On narrow windows it's an overlay. */
export function Sidebar() {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [collapseAllKey, setCollapseAllKey] = useState(0);

  const remove = (target: { kind: TreeRowModel["kind"]; collectionId: string; id: string }) => {
    if (target.kind === "collection") ws.deleteCollection(target.id);
    else ws.deleteNode(target.collectionId, target.id);
  };

  const requestDelete = (row: TreeRowModel) => {
    if (row.kind === "request") {
      remove(row);
      toast(`Deleted “${row.request.name}”.`);
      return;
    }
    const collection = ws.workspace.collections.find((c) => c.id === row.collectionId);
    const items = row.kind === "collection" ? collection?.items : collection && findFolderChildren(collection.items, row.id);
    const count = items ? countRequests(items) : 0;
    if (count === 0) {
      remove(row);
      return;
    }
    setPendingDelete({ kind: row.kind, collectionId: row.collectionId, id: row.id, name: row.name, count });
  };

  return (
    <aside
      aria-label="Collections"
      className={cn(
        "relative grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] border-r border-line bg-bg0 max-[820px]:hidden",
        ui.sidebarOpen &&
          "max-[820px]:fixed max-[820px]:top-11 max-[820px]:bottom-6 max-[820px]:left-0 max-[820px]:z-40 max-[820px]:grid max-[820px]:w-[min(280px,85vw)] max-[820px]:shadow-pop",
      )}
    >
      <div className="flex items-center gap-1.5 p-2">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-[7px] rounded-md border border-line bg-bg1 px-[9px] text-fg3 focus-within:border-brass-line">
          <Search className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter) {
                e.stopPropagation();
                setFilter("");
              }
            }}
            placeholder="Filter requests"
            aria-label="Filter requests"
            autoComplete="off"
            spellCheck={false}
            className="h-[26px] min-w-0 flex-1 bg-transparent text-[12.5px] leading-[26px] text-fg outline-none placeholder:text-fg3"
          />
        </label>
        <IconButton
          title="Collapse all"
          aria-label="Collapse all collections and folders"
          disabled={ws.workspace.collections.length === 0}
          className="disabled:pointer-events-none disabled:opacity-40"
          onClick={() => setCollapseAllKey((k) => k + 1)}
        >
          <ChevronsDownUp className="size-[13px]" strokeWidth={2.1} />
        </IconButton>
        <NewMenu
          onCreated={(id) => {
            setFilter("");
            setRenamingId(id);
          }}
        />
      </div>

      <div data-tree-scroll="" className={cn("min-h-0 overflow-auto pt-0.5 pb-2.5", TREE_SCROLL)}>
        <CollectionTree
          filter={filter}
          renamingId={renamingId}
          setRenamingId={setRenamingId}
          onDelete={requestDelete}
          collapseAllKey={collapseAllKey}
        />
      </div>

      <div className="border-t border-line p-1.5">
        <button
          type="button"
          onClick={() => {
            session.openEnvironments();
            ui.setSidebarOpen(false);
          }}
          className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-1.5 pl-2 text-left whitespace-nowrap text-fg2 hover:bg-bg2 hover:text-fg"
        >
          <Layers className="size-3.5 shrink-0 text-fg3" strokeWidth={1.9} aria-hidden />
          <span className="min-w-0 flex-1 truncate">Environments &amp; globals</span>
          <span className="text-[11px] text-fg3">{variableNameCount(ws.workspace)}</span>
        </button>
      </div>

      <SidebarResizer />

      <ConfirmDeleteDialog
        target={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </aside>
  );
}
