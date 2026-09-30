import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { JSON_TOKEN_CLASS, tokenizeJsonLike, type JsonRun } from "@/jsonTokens";
import { findRow, firstRangeAfter, indexLines, rowEnd, wrapRows } from "./codeRows";
import { buildPieces } from "./highlight";
import type { Range } from "./jsonSearch";

/** Row height: leading-5. */
const ROW = 20;
const PAD_TOP = 8;
const PAD_BOTTOM = 24;
/** Raw view's horizontal padding (px-3 on both sides). */
const PAD_X = 24;
const OVERSCAN = 20;
/** Pretty view: a line longer than this continues on the next row, so no row is megabytes wide. */
const LONG_LINE = 4000;
/** Browsers stop laying out around 2^25 px; past this the scrollbar maps onto the rows proportionally. */
const MAX_BOX = 10_000_000;
/** Lines whose tokens are kept while scrolling. */
const TOKEN_CACHE = 4000;

const NO_RANGES: Range[] = [];

interface VirtualCodeProps {
  text: string;
  /** color JSON tokens (line by line: pretty-printed JSON never breaks a token across lines) */
  json: boolean;
  ranges?: Range[];
  activeMatch?: number;
  /** "raw": no gutter, wraps to the width */
  layout?: "pretty" | "raw";
}

/**
 * The Pretty/Raw view for large bodies: only the rows in view are in the DOM.
 * Lines are laid out by character count in the monospace font, so the browser
 * never measures or wraps megabytes of text. Selection works within the rows
 * shown; the toolbar's Copy takes the whole body.
 */
export const VirtualCode = memo(function VirtualCode({ text, json, ranges = NO_RANGES, activeMatch = -1, layout = "pretty" }: VirtualCodeProps) {
  const wrap = layout === "raw";
  const scroller = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [view, setView] = useState({ top: 0, height: 600, width: 800 });
  const [charW, setCharW] = useState(7.5);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const w = probe.current?.getBoundingClientRect().width;
      if (w) setCharW(w / 10);
      setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    };
    measure();
    void document.fonts?.ready.then(measure);
    const onScroll = () => setView((v) => ({ ...v, top: el.scrollTop }));
    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      resize.disconnect();
    };
  }, []);

  const lines = useMemo(() => indexLines(text), [text]);
  const cols = wrap ? Math.max(20, Math.floor((view.width - PAD_X) / charW)) : LONG_LINE;
  const rows = useMemo(() => wrapRows(text, lines, cols), [text, lines, cols]);
  const digits = String(lines.starts.length).length;
  const gutter = wrap ? 0 : digits * charW + 22; // pl-3 + pr-2.5

  const tokens = useRef<{ text: string; lines: Map<number, JsonRun[]> }>({ text, lines: new Map() });
  if (tokens.current.text !== text) tokens.current = { text, lines: new Map() };
  const lineRuns = (l: number): JsonRun[] => {
    const cache = tokens.current.lines;
    let runs = cache.get(l);
    if (!runs) {
      if (cache.size >= TOKEN_CACHE) cache.clear();
      runs = tokenizeJsonLike(text.slice(lines.starts[l], rowEnd(text, lines.starts, l)));
      cache.set(l, runs);
    }
    return runs;
  };

  // Scroll geometry: `ratio` > 1 only when the rows are taller than a browser can lay out.
  const total = PAD_TOP + rows.length * ROW + PAD_BOTTOM;
  const box = Math.min(total, MAX_BOX);
  const ratio = box < total ? (total - view.height) / Math.max(1, box - view.height) : 1;
  const virtualTop = view.top * ratio;
  const start = Math.max(0, Math.floor((virtualTop - PAD_TOP) / ROW) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((virtualTop + view.height) / ROW) + OVERSCAN);
  const offset = view.top + (PAD_TOP + start * ROW - virtualTop);

  // Center the current match, like scrollIntoView({ block: "center" }) on the small view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const match = ranges[activeMatch];
    if (!el || !match) return;
    const i = findRow(rows, match[0]);
    el.scrollTop = (PAD_TOP + i * ROW - (el.clientHeight - ROW) / 2) / ratio;
    if (!wrap) {
      const x = gutter + (match[0] - rows[i]) * charW;
      if (x < el.scrollLeft + gutter || x > el.scrollLeft + el.clientWidth - 48) el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the match (or what it points into) changes
  }, [activeMatch, ranges, rows]);

  const shown: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const s = rows[i];
    const e = rowEnd(text, rows, i);
    let runs: JsonRun[];
    let lineNo: number | null = null;
    if (!wrap || json) {
      const l = findRow(lines.starts, s);
      if (lines.starts[l] === s) lineNo = l + 1;
      runs = json ? sliceRuns(lineRuns(l), s - lines.starts[l], e - lines.starts[l]) : [{ text: text.slice(s, e), kind: "text" }];
    } else {
      runs = [{ text: text.slice(s, e), kind: "text" }];
    }
    const content = rowContent(runs, ranges, s, e, activeMatch);
    shown.push(
      wrap ? (
        <div key={i} className="h-5 px-3 whitespace-pre">
          {content}
        </div>
      ) : (
        <div key={i} className="flex h-5">
          <span aria-hidden className="flex-none pr-2.5 pl-3 text-right text-fg3 opacity-60 select-none" style={{ width: gutter }}>
            {lineNo}
          </span>
          <span className="pr-4 whitespace-pre">{content}</span>
        </div>
      ),
    );
  }

  return (
    <div ref={scroller} className="relative min-h-0 overflow-auto font-mono text-[12.5px] leading-5">
      <span ref={probe} aria-hidden className="invisible absolute top-0 left-0 whitespace-pre">
        0000000000
      </span>
      <div
        className="relative select-text"
        style={{ height: box, minWidth: wrap ? undefined : gutter + Math.min(lines.longest, LONG_LINE) * charW + 16 }}
      >
        <div className="absolute inset-x-0 top-0" style={{ transform: `translateY(${offset}px)` }}>
          {shown}
        </div>
      </div>
    </div>
  );
});

/** The part of a line's runs that falls in [from, to). */
function sliceRuns(runs: readonly JsonRun[], from: number, to: number): JsonRun[] {
  const out: JsonRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (end > from && pos < to) {
      out.push(pos >= from && end <= to ? run : { text: run.text.slice(Math.max(0, from - pos), Math.min(run.text.length, to - pos)), kind: run.kind });
    }
    pos = end;
    if (pos >= to) break;
  }
  return out;
}

/** One row's spans and search marks. `start`/`end` are the row's offsets in the whole text. */
function rowContent(runs: readonly JsonRun[], ranges: readonly Range[], start: number, end: number, activeMatch: number): ReactNode {
  const first = firstRangeAfter(ranges, start);
  const local: Range[] = [];
  for (let r = first; r < ranges.length && ranges[r][0] < end; r++) {
    local.push([Math.max(ranges[r][0], start) - start, Math.min(ranges[r][1], end) - start]);
  }
  if (runs.length === 1 && runs[0].kind === "text" && !local.length) return runs[0].text;
  return buildPieces(runs, local).map((p, k) => {
    const cls = JSON_TOKEN_CLASS[p.kind];
    const inner = cls ? <span className={cls}>{p.text}</span> : p.text;
    if (p.match < 0) return cls ? <span key={k} className={cls}>{p.text}</span> : p.text;
    const m = first + p.match;
    return (
      <mark
        key={k}
        data-m={m}
        data-active={m === activeMatch ? "" : undefined}
        className="rounded-[2px] bg-brass-soft text-inherit data-active:bg-brass data-active:text-brass-ink [&[data-active]>span]:text-brass-ink"
      >
        {inner}
      </mark>
    );
  });
}
