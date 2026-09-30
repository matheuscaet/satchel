import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { Collection } from "@/types";
import { ROW_INDENT, ROW_PAD, resolveDrop, zoneFor, type DragSource, type Drop } from "./dropTarget";
import type { TreeRowModel } from "./treeRows";
import { rowAt } from "./treeWindow";

const THRESHOLD = 4; // px before a press becomes a drag (clicks, double-clicks, menus keep working)
const EXPAND_DELAY = 600; // ms hovering a closed folder/collection before it opens
const EDGE = 32; // px from the scroller's top/bottom where auto-scroll kicks in
const MAX_SPEED = 14; // px per frame

interface Options {
  /** The rows' container: row i's top is i × ROW_H below its top, mounted or not */
  listRef: RefObject<HTMLDivElement | null>;
  rows: TreeRowModel[];
  collections: Collection[];
  /** No dragging (the tree is filtered: the visible order isn't the real one) */
  disabled: boolean;
  onDisabledAttempt: () => void;
  onExpand: (id: string) => void;
  onDrop: (source: DragSource, drop: Drop) => void;
}

export interface TreeDrag {
  source: DragSource | null;
  drop: Drop | null;
  /** For the drag preview: it follows the pointer through its style, without re-rendering the tree. */
  previewRef: (el: HTMLDivElement | null) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
  /** Swallows the click that follows a drop, so it doesn't open/toggle the row under the pointer. */
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

const sameDrop = (a: Drop | null, b: Drop | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Drag-and-drop for the collection tree with mouse events — not HTML5 DnD, which Tauri's native
 * file-drop handler breaks inside the webview on Windows.
 */
export function useTreeDrag({ listRef, rows, collections, disabled, onDisabledAttempt, onExpand, onDrop }: Options): TreeDrag {
  const [source, setSource] = useState<DragSource | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const previewEl = useRef<HTMLDivElement | null>(null);
  const placePreview = () => {
    if (previewEl.current) previewEl.current.style.transform = `translate(${pointerRef.current.x + 14}px, ${pointerRef.current.y + 10}px)`;
  };
  const previewRef = (el: HTMLDivElement | null) => {
    previewEl.current = el;
    placePreview();
  };
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  // The window listeners outlive renders: read the latest tree through refs.
  const latest = useRef({ rows, collections, disabled, onDisabledAttempt, onExpand, onDrop });
  latest.current = { rows, collections, disabled, onDisabledAttempt, onExpand, onDrop };

  useEffect(() => () => cleanup.current?.(), []);

  const onMouseDown = (e: ReactMouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea")) return;
    const rowEl = target.closest<HTMLElement>("[data-tree-row]");
    const row = rowEl && latest.current.rows.find((r) => r.id === rowEl.dataset.rowId);
    if (!row) return;
    cleanup.current?.();

    const from = { x: e.clientX, y: e.clientY };
    const pointer = (pointerRef.current = { ...from });
    const dragged: DragSource = { id: row.id, kind: row.kind };
    let started = false;
    let current: Drop | null = null;
    let expandId: string | null = null;
    let expandTimer = 0;
    let scrollFrame = 0;

    const scroller = () => listRef.current?.closest<HTMLElement>("[data-tree-scroll]") ?? null;

    const clearExpand = () => {
      window.clearTimeout(expandTimer);
      expandId = null;
    };

    const setCurrent = (next: Drop | null) => {
      if (sameDrop(current, next)) return;
      current = next;
      setDrop(next);
    };

    const resolveAt = () => {
      const list = listRef.current;
      const box = scroller()?.getBoundingClientRect();
      if (!list || !box || pointer.x < box.left || pointer.x > box.right || pointer.y < box.top || pointer.y > box.bottom) {
        clearExpand();
        setCurrent(null);
        return;
      }
      const { rows, collections } = latest.current;
      // The row under the pointer, from its position alone: most rows aren't mounted (see treeWindow).
      const listBox = list.getBoundingClientRect();
      const hit = rowAt(pointer.y - listBox.top, rows.length);
      if (!hit) return;
      const { index, rel } = hit;
      const hovered = rows[index];
      const pointerDepth = Math.floor((pointer.x - listBox.left - ROW_PAD) / ROW_INDENT);
      setCurrent(resolveDrop(collections, rows, dragged, index, rel, pointerDepth));

      // Hovering the middle of a closed folder/collection opens it after a moment.
      const wantsExpand =
        hovered.kind !== "request" && !hovered.open && dragged.kind !== "collection" && zoneFor(hovered.kind, rel) === "inside" && hovered.id !== dragged.id;
      if (!wantsExpand) clearExpand();
      else if (expandId !== hovered.id) {
        clearExpand();
        expandId = hovered.id;
        expandTimer = window.setTimeout(() => {
          latest.current.onExpand(hovered.id);
          expandId = null;
          // The rows below it moved: re-resolve once the tree has re-rendered.
          requestAnimationFrame(resolveAt);
        }, EXPAND_DELAY);
      }
    };

    const autoScroll = () => {
      const el = scroller();
      if (el) {
        const box = el.getBoundingClientRect();
        let dy = 0;
        if (pointer.x >= box.left && pointer.x <= box.right) {
          if (pointer.y < box.top + EDGE && pointer.y > box.top - 2 * EDGE) dy = -(box.top + EDGE - pointer.y) / 3;
          else if (pointer.y > box.bottom - EDGE && pointer.y < box.bottom + 2 * EDGE) dy = (pointer.y - (box.bottom - EDGE)) / 3;
        }
        if (dy) {
          const before = el.scrollTop;
          el.scrollTop += Math.max(-MAX_SPEED, Math.min(MAX_SPEED, Math.round(dy) || Math.sign(dy)));
          if (el.scrollTop !== before) resolveAt();
        }
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    };

    const begin = () => {
      if (latest.current.disabled) {
        latest.current.onDisabledAttempt();
        finish(false);
        return;
      }
      started = true;
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
      setSource(dragged);
      scrollFrame = requestAnimationFrame(autoScroll);
      resolveAt();
    };

    const onMove = (ev: MouseEvent) => {
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      if (!started) {
        if (Math.hypot(pointer.x - from.x, pointer.y - from.y) < THRESHOLD) return;
        begin();
        return;
      }
      ev.preventDefault();
      placePreview();
      resolveAt();
    };

    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      finish(true);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (started) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      finish(false);
    };

    const onBlur = () => finish(false);

    const teardown = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      cancelAnimationFrame(scrollFrame);
      clearExpand();
      document.body.style.userSelect = "";
      cleanup.current = null;
    };

    function finish(commit: boolean) {
      teardown();
      if (!started) return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      setSource(null);
      setDrop(null);
      if (commit && current) latest.current.onDrop(dragged, current);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    cleanup.current = teardown;
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return { source, drop, previewRef, onMouseDown, onClickCapture };
}
