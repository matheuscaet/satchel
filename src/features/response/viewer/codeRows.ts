import type { Range } from "./jsonSearch";

/**
 * Row layout for the virtualized code view: where each line starts, and how
 * lines split into fixed-width rows. Offsets are UTF-16 indices into the text.
 */

export interface LineIndex {
  /** start offset of each line */
  starts: Uint32Array;
  /** length of the longest line, without its line break */
  longest: number;
}

export function indexLines(text: string): LineIndex {
  let count = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) count++;
  const starts = new Uint32Array(count);
  let longest = 0;
  let prev = 0;
  let n = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
    longest = Math.max(longest, i - prev);
    starts[n++] = prev = i + 1;
  }
  longest = Math.max(longest, text.length - prev);
  return { starts, longest };
}

/**
 * Split lines into rows of at most `cols` characters (never between the two
 * halves of a surrogate pair). A line that fits is one row.
 */
export function wrapRows(text: string, lines: LineIndex, cols: number): Uint32Array {
  const { starts } = lines;
  if (lines.longest <= cols) return starts;
  const width = Math.max(1, cols);
  const out: number[] = [];
  for (let l = 0; l < starts.length; l++) {
    const start = starts[l];
    const end = lineEnd(text, starts, l);
    out.push(start);
    let pos = start + width;
    while (pos < end) {
      const c = text.charCodeAt(pos);
      if (c >= 0xdc00 && c <= 0xdfff) pos--; // keep the pair together
      out.push(pos);
      pos += width;
    }
  }
  return Uint32Array.from(out);
}

/** End of line `l` (exclusive), without its "\n" or "\r\n". */
export function lineEnd(text: string, starts: Uint32Array, l: number): number {
  let end = l + 1 < starts.length ? starts[l + 1] - 1 : text.length;
  if (end > starts[l] && text.charCodeAt(end - 1) === 13) end--;
  return end;
}

/** End of row `i` (exclusive), without the line break that may close it. */
export function rowEnd(text: string, rows: Uint32Array, i: number): number {
  let end = i + 1 < rows.length ? rows[i + 1] : text.length;
  if (end > rows[i] && text.charCodeAt(end - 1) === 10) {
    end--;
    if (end > rows[i] && text.charCodeAt(end - 1) === 13) end--;
  }
  return end;
}

/** Index of the last entry ≤ `offset` in a sorted array. */
export function findRow(rows: ArrayLike<number>, offset: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Index of the first range ending after `offset` (ranges sorted, non-overlapping). */
export function firstRangeAfter(ranges: readonly Range[], offset: number): number {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
