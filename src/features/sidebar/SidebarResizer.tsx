import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";

const KEY = "satchel.sidebarWidth";
export const SIDEBAR_DEFAULT = 256;
const MIN = 200;
const MAX = 480;
const STEP = 16;

const clamp = (n: number) => Math.round(Math.min(MAX, Math.max(MIN, n)));

function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    if (n >= MIN && n <= MAX) return n;
  } catch {
    // ignore
  }
  return SIDEBAR_DEFAULT;
}

function saveWidth(width: number) {
  try {
    if (width === SIDEBAR_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(width));
  } catch {
    // ignore
  }
}

/** The width lives in `--sidebar-w` on <html>: the shell grid and the header's brand cell both read it. */
function applyWidth(width: number) {
  document.documentElement.style.setProperty("--sidebar-w", `${width}px`);
}

/**
 * 1px drag handle on the sidebar's right edge (200–480px, double-click resets, ←/→ by 16px).
 * Hidden on narrow windows, where the sidebar is an overlay. Lives inside the (relative) <aside>.
 */
export function SidebarResizer() {
  const [width, setWidth] = useState(loadWidth);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => applyWidth(width), [width]);

  const commit = (next: number | ((current: number) => number)) =>
    setWidth((current) => {
      const w = clamp(typeof next === "function" ? next(current) : next);
      saveWidth(w);
      return w;
    });

  const onMouseDown = (e: ReactMouseEvent) => {
    const aside = ref.current?.parentElement;
    if (e.button !== 0 || !aside) return;
    e.preventDefault();
    ref.current?.focus({ preventScroll: true });
    const left = aside.getBoundingClientRect().left;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    let last = width;
    // Only the CSS variable moves while dragging: no React re-render of the whole sidebar per mousemove.
    const move = (ev: MouseEvent) => {
      last = clamp(ev.clientX - left);
      applyWidth(last);
      ref.current?.setAttribute("aria-valuenow", String(last));
    };
    const up = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      commit(last);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const next =
      e.key === "ArrowLeft" ? (w: number) => w - STEP
      : e.key === "ArrowRight" ? (w: number) => w + STEP
      : e.key === "Home" ? MIN
      : e.key === "End" ? MAX
      : e.key === "Enter" ? SIDEBAR_DEFAULT
      : null;
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onMouseDown={onMouseDown}
      onDoubleClick={() => commit(SIDEBAR_DEFAULT)}
      onKeyDown={onKeyDown}
      className={cn(
        // Sits on top of the aside's 1px border; the ::after is a wider invisible hit area.
        "absolute inset-y-0 -right-px z-20 w-px cursor-col-resize after:absolute after:inset-y-0 after:-inset-x-1 after:content-[''] hover:bg-brass-line focus-visible:bg-brass focus-visible:outline-none max-[820px]:hidden",
        dragging && "bg-brass-line",
      )}
    />
  );
}
