import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Folder } from "lucide-react";
import { siblingStep } from "@/collectionTree";
import { MethodLabel } from "@/components/common/MethodLabel";
import { useCopyAsCurl } from "@/features/curl/useCopyAsCurl";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";
import { cn } from "@/lib/utils";
import { TreeRow, type MenuOpening, type RowAction, type RowHandlers } from "./TreeRow";
import { ancestorIds, containerIds, keepUnchangedRows, visibleRows, type TreeRowModel } from "./treeRows";
import { ROW_INDENT, ROW_PAD, type DragSource, type Drop, type DropIndicator } from "./dropTarget";
import { ROW_H, revealScrollTop, rowWindow, visibleSpan, type VisibleSpan } from "./treeWindow";
import { closedToStore, loadClosed, saveClosed, treeStateKey } from "./treeState";
import { useTreeDrag } from "./useTreeDrag";

interface CollectionTreeProps {
  filter: string;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  onDelete: (row: TreeRowModel) => void;
  /** Bumped by the sidebar's "Collapse all" button */
  collapseAllKey: number;
}

const scrollerOf = (el: HTMLElement | null) => el?.closest<HTMLElement>("[data-tree-scroll]") ?? null;

/**
 * The collections → folders → requests tree, with roving keyboard focus. Only the rows in and
 * around the sidebar's viewport are mounted (see treeWindow), plus the few that must stay: the Tab
 * stop, the focused row, the one being renamed and the one whose menu is open.
 */
export function CollectionTree({ filter, renamingId, setRenamingId, onDelete, collapseAllKey }: CollectionTreeProps) {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const actions = useAppActions();
  const copyAsCurl = useCopyAsCurl();
  const collections = ws.workspace.collections;

  // Closed collections and folders, remembered per workspace (and reloaded when another one opens).
  const treeKey = treeStateKey(ws.source);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => loadClosed(treeKey));
  const [closedFor, setClosedFor] = useState(treeKey);
  const loadedClosed = useRef(closed);
  if (closedFor !== treeKey) {
    const next = loadClosed(treeKey);
    loadedClosed.current = next;
    setClosedFor(treeKey);
    setClosed(next);
  }
  const [menu, setMenu] = useState<{ id: string; via: MenuOpening } | null>(null);
  const [reorderHint, setReorderHint] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [span, setSpan] = useState<VisibleSpan>({ first: 0, last: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  // A row that moved (drag or Alt+↑/↓) gets focus back once the tree has re-rendered.
  const focusAfterRender = useRef<string | null>(null);
  // A row to scroll to (and focus) that needs a render first: to be revealed, or mounted.
  const pendingShow = useRef<{ id: string; focus: boolean; waitingFor: "rows" | "mount" } | null>(null);

  // Rows that didn't change keep their object (an edit elsewhere in the workspace re-renders no row).
  const lastRows = useRef<TreeRowModel[]>([]);
  const rows = useMemo(
    () => (lastRows.current = keepUnchangedRows(lastRows.current, visibleRows(collections, filter, closed))),
    [collections, filter, closed],
  );
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  // For focus/scroll requests that run after a frame (rename) or from an older render's closure.
  const latestIndex = useRef(indexOf);
  latestIndex.current = indexOf;
  const selectedId = session.activeTab;
  const filtering = filter.trim() !== "";

  const setOpen = (id: string, open: boolean) =>
    setClosed((prev) => {
      if (prev.has(id) === !open) return prev;
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });

  const reveal = (nodeId: string) =>
    setClosed((prev) => {
      const hidden = ancestorIds(collections, nodeId).filter((id) => prev.has(id));
      if (hidden.length === 0) return prev;
      const next = new Set(prev);
      hidden.forEach((id) => next.delete(id));
      return next;
    });

  const hintTimer = useRef(0);
  const showReorderHint = () => {
    setReorderHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setReorderHint(false), 2600);
  };
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);
  useEffect(() => {
    if (!filtering) setReorderHint(false);
  }, [filtering]);

  const drop = (source: DragSource, target: Drop) => {
    if (target.kind === "collection") ws.moveCollection(source.id, target.toIndex);
    else {
      ws.moveNode(source.id, target.target);
      // Dropped into a closed folder/collection: open it so the item stays in sight.
      setOpen(target.target.parentFolderId ?? target.target.collectionId, true);
    }
    focusAfterRender.current = source.id;
  };

  const drag = useTreeDrag({
    listRef,
    rows,
    collections,
    disabled: filtering,
    onDisabledAttempt: showReorderHint,
    onExpand: (id) => setOpen(id, true),
    onDrop: drop,
  });

  // Which rows the scroller shows: re-measured on scroll, resize, and when the rows above/around change.
  const measure = useCallback(() => {
    const list = listRef.current;
    const scroller = scrollerOf(list);
    if (!list || !scroller) return;
    const top = scroller.getBoundingClientRect().top + scroller.clientTop - list.getBoundingClientRect().top;
    const next = visibleSpan(top, scroller.clientHeight);
    setSpan((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
    // Pin the focused row before the window moves off it (focus events alone can arrive late).
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches("[data-tree-row]") && list.contains(active)) setFocusedId(active.dataset.rowId ?? null);
  }, []);
  const hasRows = rows.length > 0;
  useEffect(() => {
    const scroller = scrollerOf(listRef.current);
    if (!scroller) return;
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [hasRows, measure]);
  useLayoutEffect(() => measure(), [rows.length, reorderHint, measure]);

  /** Scrolls the least needed to show row `index` whole, and re-windows now (the scroll event comes later). */
  const scrollToIndex = (index: number) => {
    const list = listRef.current;
    const scroller = scrollerOf(list);
    if (!list || !scroller) return;
    const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
    const top = revealScrollTop(listTop + index * ROW_H, scroller.scrollTop, scroller.clientHeight);
    if (top === scroller.scrollTop) return;
    scroller.scrollTop = top;
    measure();
  };

  const rowEl = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`) ?? null;

  /**
   * Scrolls a row into view and optionally focuses it. A row that isn't in `rows` yet (about to be
   * revealed) or isn't mounted yet (far from the viewport) is finished after the next render.
   */
  const showRow = (id: string, focus: boolean, waitForRows = true) => {
    pendingShow.current = null;
    const index = latestIndex.current.get(id);
    if (index === undefined) {
      if (waitForRows) pendingShow.current = { id, focus, waitingFor: "rows" };
      return;
    }
    scrollToIndex(index);
    if (!focus) return;
    const el = rowEl(id);
    if (el) el.focus({ preventScroll: true });
    else pendingShow.current = { id, focus, waitingFor: "mount" };
  };

  useLayoutEffect(() => {
    const pending = pendingShow.current;
    if (!pending) return;
    pendingShow.current = null;
    if (pending.waitingFor === "rows") showRow(pending.id, pending.focus, false);
    else rowEl(pending.id)?.focus({ preventScroll: true });
  });

  useEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    focusAfterRender.current = null;
    focusRow(id);
  });

  // Saved when the user opens or closes something, not when a stored state is loaded.
  useEffect(() => {
    if (closed === loadedClosed.current || closedFor !== treeKey) return;
    saveClosed(treeKey, closedToStore(closed, containerIds(collections)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on changes to `closed` only
  }, [closed]);

  // "Collapse all": every collection and folder closes (the open request stays open in its tab).
  useEffect(() => {
    if (collapseAllKey > 0) setClosed(new Set(containerIds(collections)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the button press
  }, [collapseAllKey]);

  // Opening a request (tab, palette, new request…) reveals and scrolls to it.
  useEffect(() => {
    if (!selectedId) return;
    reveal(selectedId);
    showRow(selectedId, false);
  }, [selectedId]);

  // A node being renamed (e.g. just created) must be visible.
  useEffect(() => {
    if (renamingId) reveal(renamingId);
  }, [renamingId]);

  const activate = (row: TreeRowModel) => {
    if (row.kind === "request") {
      session.openTab(row.id);
      ui.setSidebarOpen(false);
    } else {
      setOpen(row.id, !row.open);
    }
  };

  const runAction = (row: TreeRowModel, action: RowAction) => {
    const folderId = row.kind === "folder" ? row.id : null;
    switch (action) {
      case "new-request":
        setOpen(row.id, true);
        actions.newRequest(row.collectionId, folderId);
        ui.setSidebarOpen(false);
        break;
      case "new-folder": {
        setOpen(row.id, true);
        setRenamingId(ws.addFolder(row.collectionId, folderId));
        break;
      }
      case "rename":
        setRenamingId(row.id);
        break;
      case "delete":
        onDelete(row);
        break;
      case "copy-curl":
        copyAsCurl(row.id, { resolve: true });
        break;
      case "copy-curl-raw":
        copyAsCurl(row.id, { resolve: false });
        break;
    }
  };

  /** Alt+↑/↓: move the row one step among its siblings (collections among collections). */
  const moveByKey = (row: TreeRowModel, step: -1 | 1) => {
    if (filtering) {
      showReorderHint();
      return;
    }
    if (row.kind === "collection") {
      const index = collections.findIndex((c) => c.id === row.id);
      const to = step < 0 ? index - 1 : index + 2;
      if (index < 0 || to < 0 || to > collections.length) return;
      ws.moveCollection(row.id, to);
    } else {
      const target = siblingStep(collections, row.id, step);
      if (!target) return;
      ws.moveNode(row.id, target);
    }
    focusAfterRender.current = row.id;
  };

  const commitRename = (row: TreeRowModel, name: string | null) => {
    setRenamingId(null);
    if (name) {
      if (row.kind === "collection") ws.renameCollection(row.id, name);
      else ws.renameNode(row.collectionId, row.id, name);
    }
    requestAnimationFrame(() => focusRow(row.id));
  };

  const focusRow = (id: string) => showRow(id, true);

  // Rows get one handlers object for good; it reaches this render's functions through a ref.
  const latest = useRef({ activate, runAction, commitRename });
  latest.current = { activate, runAction, commitRename };
  const handlers = useMemo<RowHandlers>(
    () => ({
      activate: (row) => latest.current.activate(row),
      // A second "open" for the same row (the ContextMenu key also fires a contextmenu event) keeps the first.
      menu: (row, open, via = "pointer") =>
        setMenu((prev) => (open ? (prev?.id === row.id ? prev : { id: row.id, via }) : prev?.id === row.id ? null : prev)),
      renameDone: (row, name) => latest.current.commitRename(row, name),
      action: (row, action) => latest.current.runAction(row, action),
    }),
    [],
  );

  // The focused row stays mounted even when scrolled far away, so keyboard focus isn't lost.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.matches("[data-tree-row]")) setFocusedId(target.dataset.rowId ?? null);
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedId(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-tree-row]")) return;
    const index = indexOf.get(target.dataset.rowId ?? "") ?? -1;
    const row = rows[index];
    if (!row) return;
    const move = (to: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (next) focusRow(next.id);
    };
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveByKey(row, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.kind !== "request") {
          if (!row.open) setOpen(row.id, true);
          else move(index + 1);
        }
        break;
      case "ArrowLeft":
        if (row.kind !== "request" && row.open) setOpen(row.id, false);
        else {
          const parent = row.kind === "collection" ? null : (row.parentId ?? row.collectionId);
          if (parent) focusRow(parent);
        }
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      case "F2":
        setRenamingId(row.id);
        break;
      case "ContextMenu":
        handlers.menu(row, true, "keyboard");
        break;
      default:
        if (e.key === "F10" && e.shiftKey) {
          handlers.menu(row, true, "keyboard");
          break;
        }
        return;
    }
    e.preventDefault();
  };

  if (collections.length === 0) {
    return (
      <div className="px-4 py-[18px] text-[12.5px] leading-[1.55] text-fg3">
        No collections yet.
        <br />
        Paste a cURL, import a Postman export, or create a request. Everything lands here.
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="px-4 py-[18px] text-[12.5px] leading-[1.55] text-fg3">Nothing matches “{filter}”.</div>;
  }

  const tabStopId = selectedId && indexOf.has(selectedId) ? selectedId : rows[0].id;

  const indicator = drag.drop?.indicator;
  const dragged = drag.source && rows.find((r) => r.id === drag.source?.id);
  const lineIndex = indicator?.type === "line" ? indexOf.get(indicator.rowId) : undefined;

  const { start, end } = rowWindow(span, rows.length);
  // Rows outside the window that must stay mounted, in tree order (so Tab order is right).
  const pinned = [...new Set([tabStopId, focusedId, renamingId, menu?.id])]
    .map((id) => (id ? indexOf.get(id) : undefined))
    .filter((i): i is number => i !== undefined && (i < start || i >= end))
    .sort((a, b) => a - b);
  // One list, so a row moving in or out of the window keeps its element (and focus).
  const windowed = Array.from({ length: end - start }, (_, k) => start + k);
  const mounted = [...pinned.filter((i) => i < start), ...windowed, ...pinned.filter((i) => i >= end)];
  const renderRow = (index: number) => {
    const row = rows[index];
    return (
      <TreeRow
        key={row.id}
        row={row}
        selected={row.kind === "request" && row.id === selectedId}
        tabStop={row.id === tabStopId}
        renaming={row.id === renamingId}
        menu={menu?.id === row.id ? menu.via : null}
        handlers={handlers}
        dropInside={indicator?.type === "inside" && indicator.rowId === row.id}
        dragging={drag.source?.id === row.id}
        pinnedTop={index < start || index >= end ? index * ROW_H : undefined}
      />
    );
  };

  return (
    <div
      role="tree"
      aria-label="Collections"
      aria-describedby={reorderHint ? "tree-reorder-hint" : undefined}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseDown={drag.onMouseDown}
      onClickCapture={drag.onClickCapture}
      className="relative"
    >
      {reorderHint && (
        <div
          id="tree-reorder-hint"
          role="status"
          className="sticky top-0 z-10 mx-2 mb-1 rounded-md bg-bg2 px-2 py-1 text-[11.5px] leading-[1.45] text-fg2 shadow-pop"
        >
          Clear the filter to reorder: while filtering, the tree doesn’t show the real order.
        </div>
      )}
      {/* Full height for every row; the unmounted ones above the window are its top padding. */}
      <div ref={listRef} className="relative" style={{ height: rows.length * ROW_H, paddingTop: start * ROW_H }}>
        {mounted.map(renderRow)}
        {indicator?.type === "line" && lineIndex !== undefined && <DropLine index={lineIndex} indicator={indicator} />}
      </div>
      {drag.source &&
        createPortal(
          <>
            {/* Catches the pointer during a drag: one cursor everywhere, no hover effects underneath. */}
            <div aria-hidden className={cn("fixed inset-0 z-[90]", drag.drop ? "cursor-grabbing" : "cursor-no-drop")} />
            <div
              ref={drag.previewRef}
              aria-hidden
              className="pointer-events-none fixed top-0 left-0 z-[91] flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-bg1 px-2 text-[13px] whitespace-nowrap text-fg shadow-pop"
            >
              {dragged?.kind === "request" ? (
                <MethodLabel method={dragged.request.method} short />
              ) : dragged?.kind === "folder" ? (
                <Folder className="size-3.5 shrink-0 text-fg3" strokeWidth={1.9} />
              ) : null}
              <span className={cn("min-w-0 truncate", dragged?.kind === "collection" && "font-medium")}>
                {dragged ? (dragged.kind === "request" ? dragged.request.name : dragged.name) : ""}
              </span>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/** The 2px brass line between rows, indented to the depth the item would land at. `index` is the row it's drawn on. */
function DropLine({ index, indicator }: { index: number; indicator: Extract<DropIndicator, { type: "line" }> }) {
  return (
    <div
      aria-hidden
      style={{ top: (index + (indicator.edge === "bottom" ? 1 : 0)) * ROW_H - 1, left: ROW_PAD + indicator.depth * ROW_INDENT }}
      className="pointer-events-none absolute right-1.5 z-10 h-0.5 rounded-full bg-brass before:absolute before:-top-0.5 before:-left-1.5 before:size-1.5 before:rounded-full before:border-[1.5px] before:border-brass before:bg-bg0"
    />
  );
}
