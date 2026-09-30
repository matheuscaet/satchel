/**
 * The tree only mounts the rows in (and just around) the scroller's viewport. Every row is one
 * fixed-height line, so positions are plain arithmetic on the rows array — no DOM queries.
 */

/** Height of one tree row (TreeRow's `h-7`). */
export const ROW_H = 28;
/** Rows mounted above and below the viewport, so short scrolls and arrow keys land on mounted rows. */
export const OVERSCAN = 10;

/** The rows the viewport shows, partly or fully: `first` inclusive, `last` exclusive (not clamped to the row count). */
export interface VisibleSpan {
  first: number;
  last: number;
}

/**
 * Rows under a viewport `height` px tall whose top is `top` px below the first row's top
 * (negative when the list starts lower, e.g. below a banner).
 */
export function visibleSpan(top: number, height: number): VisibleSpan {
  const first = Math.max(0, Math.floor(top / ROW_H));
  return { first, last: Math.max(first, Math.ceil((top + height) / ROW_H)) };
}

/** Rows to mount, [start, end): the visible span plus overscan, within `count` rows. */
export function rowWindow(span: VisibleSpan, count: number, overscan = OVERSCAN): { start: number; end: number } {
  const start = Math.min(Math.max(0, span.first - overscan), count);
  return { start, end: Math.max(start, Math.min(count, span.last + overscan)) };
}

/**
 * The row under a pointer `y` px below the first row's top, and where inside it (0 = top … 1 = bottom).
 * Above the first row counts as its top edge, below the last as its bottom edge; null without rows.
 */
export function rowAt(y: number, count: number): { index: number; rel: number } | null {
  if (count === 0) return null;
  const index = Math.max(0, Math.min(count - 1, Math.floor(y / ROW_H)));
  return { index, rel: Math.max(0, Math.min(1, (y - index * ROW_H) / ROW_H)) };
}

/**
 * The scrollTop that brings a row fully into view, moving as little as possible (like
 * scrollIntoView's "nearest"); `rowTop` is in the scroller's content coordinates.
 */
export function revealScrollTop(rowTop: number, scrollTop: number, viewHeight: number): number {
  if (rowTop < scrollTop) return rowTop;
  // A viewport shorter than a row shows its top.
  if (rowTop + ROW_H > scrollTop + viewHeight) return viewHeight < ROW_H ? rowTop : rowTop + ROW_H - viewHeight;
  return scrollTop;
}
