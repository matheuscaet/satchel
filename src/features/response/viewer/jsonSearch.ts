import { formatPath, resolvePathQuery, type JsonPath } from "./jsonPath";
import { isContainer } from "./treeModel";

export type SearchScope = "all" | "keys" | "values";

/** Stop collecting past this many matches; the counter shows "10000+". */
export const MATCH_CAP = 10_000;

/** [start, end) offsets into a string. */
export type Range = [number, number];

export interface TreeMatch {
  id: string;
  path: JsonPath;
}

export interface TreeSearchResult {
  matches: TreeMatch[];
  /** the query resolved as a path; `matches` is that one node */
  byPath: boolean;
  capped: boolean;
}

/** Text shown for a primitive in the tree (strings unquoted). */
export function primitiveText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(value);
}

/**
 * Nodes matching the query, in document order. Keys scope matches object keys; values scope
 * matches primitives (strings, numbers, true/false/null). A query that resolves as a path
 * (`data[0].name`) wins and yields exactly that node.
 */
export function searchTree(root: unknown, query: string, scope: SearchScope, cap = MATCH_CAP): TreeSearchResult {
  const q = query.trim();
  if (!q) return { matches: [], byPath: false, capped: false };
  const resolved = resolvePathQuery(root, q);
  if (resolved) return { matches: [{ id: formatPath(resolved), path: resolved }], byPath: true, capped: false };

  const needle = q.toLowerCase();
  const keys = scope !== "values";
  const values = scope !== "keys";
  const matches: TreeMatch[] = [];
  let capped = false;

  const path: JsonPath = []; // mutable walk stack; copied (and its id formatted) only on a hit
  const visit = (value: unknown, key: string | null): boolean => {
    const hit =
      (keys && key !== null && key.toLowerCase().includes(needle)) ||
      (values && !isContainer(value) && primitiveText(value).toLowerCase().includes(needle));
    if (hit) {
      if (matches.length >= cap) {
        capped = true;
        return false;
      }
      matches.push({ id: formatPath(path), path: path.slice() });
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        path.push(i);
        const go = visit(value[i], null);
        path.pop();
        if (!go) return false;
      }
    } else if (isContainer(value)) {
      for (const k of Object.keys(value)) {
        path.push(k);
        const go = visit((value as Record<string, unknown>)[k], k);
        path.pop();
        if (!go) return false;
      }
    }
    return true;
  };
  visit(root, null);
  return { matches, byPath: false, capped };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let cachedQuery = "";
let cachedRe = /(?:)/gi;
function queryRegExp(query: string): RegExp {
  if (query !== cachedQuery) {
    cachedQuery = query;
    cachedRe = new RegExp(escapeRegExp(query), "gi");
  }
  cachedRe.lastIndex = 0;
  return cachedRe;
}

/** Case-insensitive, non-overlapping occurrences of `query` in `text`, optionally only within [from, to). */
export function findRanges(text: string, query: string, cap = MATCH_CAP, from = 0, to = text.length, out: Range[] = []): Range[] {
  if (!query) return out;
  const sub = from === 0 && to === text.length ? text : text.slice(from, to);
  const re = queryRegExp(query);
  let m: RegExpExecArray | null;
  while (out.length < cap && (m = re.exec(sub)) !== null) out.push([from + m.index, from + m.index + m[0].length]);
  return out;
}

// Same token shapes as src/jsonTokens.ts, kept index-based so multi-MB bodies don't allocate runs.
const TOKEN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;
const FOLLOWED_BY_COLON = /\s*:/y;

/**
 * Text search for the Pretty/Raw views. With `json` and a keys/values scope, only text inside
 * keys (between the quotes) or inside string/number/literal values counts.
 */
export function searchText(text: string, query: string, scope: SearchScope, json: boolean, cap = MATCH_CAP): Range[] {
  const q = query.trim();
  if (!q) return [];
  if (!json || scope === "all") return findRanges(text, q, cap);

  const out: Range[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (out.length < cap && (m = TOKEN.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const quoted = m[0][0] === '"';
    let isKey = false;
    if (quoted) {
      FOLLOWED_BY_COLON.lastIndex = end;
      isKey = FOLLOWED_BY_COLON.test(text);
    }
    if (scope === "keys" ? !isKey : isKey) continue;
    if (quoted) findRanges(text, q, cap, start + 1, end - 1, out);
    else findRanges(text, q, cap, start, end, out);
  }
  return out;
}

/** Ranges of `query` in a short string, for highlighting a tree key or value. */
export function highlightRanges(text: string, query: string): Range[] {
  return findRanges(text, query.trim(), 200);
}
