import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronsDownUp, ChevronsUpDown, Copy, ExternalLink, FileSpreadsheet, Search } from "lucide-react";
import { Segmented } from "@/components/common/Segmented";
import { MOD } from "@/components/common/Kbd";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { JsonViewer } from "../JsonViewer";
import { copyWithToast } from "./copy";
import { displayPath, resolvePathQuery, type JsonPath } from "./jsonPath";
import { MATCH_CAP, searchText, searchTree, type Range, type SearchScope } from "./jsonSearch";
import { JsonTree, type JsonTreeHandle } from "./JsonTree";
import { parseJsonCached, prettyJsonCached, type ParsedJson } from "./parseJson";
import { SearchBar } from "./SearchBar";
import { ToolbarButton } from "./ToolbarButton";
import { useViewMode, type ViewMode } from "./useViewMode";
import { findRecordLists } from "./table/tableModel";
import { TableView, useTableState } from "./table/TableView";
import { VirtualCode } from "./VirtualCode";

export interface ResponseViewerProps {
  /** body exactly as received; JSON is indented here for the Pretty view */
  rawText: string;
  isJson: boolean;
  variant: "pane" | "window";
  /** pane only: shows the "open in new window" button */
  onOpenWindow?: () => void;
}

const MODES: { value: ViewMode; label: string }[] = [
  { value: "pretty", label: "Pretty" },
  { value: "tree", label: "Tree" },
  { value: "table", label: "Table" },
  { value: "raw", label: "Raw" },
];
const NO_RANGES: Range[] = [];
const NOT_JSON: ParsedJson = { ok: false };
/** Bodies above this size debounce the search while typing. */
const DEBOUNCE_ABOVE = 200_000;
/** Pretty/Raw bodies above this size render only the rows in view. */
const VIRTUALIZE_ABOVE = 100_000;

/** Response body with Pretty / Tree / Raw views, search, and copy. Used by the response pane and the pop-out window. */
export function ResponseViewer({ rawText, isJson, variant, onOpenWindow }: ResponseViewerProps) {
  const isWindow = variant === "window";
  const parsed = useMemo(() => (isJson ? parseJsonCached(rawText) : NOT_JSON), [rawText, isJson]);
  const [stored, setMode] = useViewMode();
  // Lists of records the Table view can show (the root array, or envelopes like { data: [...] }).
  const lists = useMemo(() => (parsed.ok ? findRecordLists(parsed.value) : []), [parsed]);
  const modes = MODES.filter((m) => (m.value === "tree" ? parsed.ok : m.value === "table" ? lists.length > 0 : true));
  // A remembered mode this body can't show falls back: Table → Tree → Pretty.
  const mode: ViewMode =
    stored === "table" && !lists.length ? (parsed.ok ? "tree" : "pretty") : stored === "tree" && !parsed.ok ? "pretty" : stored;
  // Indented only when the Pretty view shows it: Tree and Table work from the parsed value.
  const indent = mode === "pretty" && isJson;
  const text = useMemo(() => (indent ? prettyJsonCached(rawText) : rawText), [indent, rawText]);

  // Search
  const [searchOpen, setSearchOpen] = useState(isWindow);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const debounced = useDebounced(input.trim(), 180);
  const query = rawText.length > DEBOUNCE_ABOVE ? debounced : input.trim();
  const effScope: SearchScope = isJson ? scope : "all";
  const inputRef = useRef<HTMLInputElement>(null);
  const [focusTick, setFocusTick] = useState(0);

  const table = useTableState(lists, mode === "table" ? query : "", effScope);

  const treeSearch = useMemo(
    () => (mode === "tree" && parsed.ok && query ? searchTree(parsed.value, query, effScope) : null),
    [mode, parsed, query, effScope],
  );
  const ranges = useMemo(
    () => (mode !== "tree" && mode !== "table" && query ? searchText(text, query, effScope, isJson) : NO_RANGES),
    [mode, text, query, effScope, isJson],
  );
  const count = !query ? null : mode === "table" ? table.matches.length : treeSearch ? treeSearch.matches.length : ranges.length;
  const capped = treeSearch ? treeSearch.capped : ranges.length >= MATCH_CAP;

  // The current match resets whenever what's being searched changes.
  const searchKey = `${mode}\u0000${effScope}\u0000${query}\u0000${text.length}`;
  const [cursor, setCursor] = useState({ key: searchKey, index: 0 });
  const active = count && cursor.key === searchKey ? Math.min(cursor.index, count - 1) : 0;
  const step = (dir: 1 | -1) => {
    if (count) setCursor({ key: searchKey, index: (active + dir + count) % count });
  };

  // A path typed in Pretty/Raw: offer to jump to it in the tree.
  const pathInTree = mode !== "tree" && mode !== "table" && parsed.ok && query ? resolvePathQuery(parsed.value, query) : null;

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setFocusTick((t) => t + 1);
  }, []);
  const closeSearch = () => {
    setInput("");
    if (!isWindow) setSearchOpen(false);
  };

  useEffect(() => {
    if (!focusTick) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  // The pop-out window owns the whole page, so ⌘F works anywhere in it.
  useEffect(() => {
    if (!isWindow) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isWindow, openSearch]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isWindow) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape" && searchOpen) {
      closeSearch();
    }
  };

  // Tree
  const treeRef = useRef<JsonTreeHandle>(null);
  const [selectedPath, setSelectedPath] = useState<JsonPath | null>(null);

  const searchBar = (
    <SearchBar
      inputRef={inputRef}
      value={input}
      onChange={setInput}
      scope={scope}
      onScope={setScope}
      showScope={isJson}
      count={count}
      capped={capped}
      active={active}
      onNext={() => step(1)}
      onPrev={() => step(-1)}
      onEscape={closeSearch}
      onClose={isWindow ? undefined : closeSearch}
      className="min-w-0 flex-1"
      aside={
        pathInTree && (
          <button
            type="button"
            onClick={() => setMode("tree")}
            className="h-[18px] flex-none rounded-sm px-1.5 text-[11px] whitespace-nowrap text-brass hover:bg-brass-soft"
          >
            Show in Tree
          </button>
        )
      }
    />
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        onKeyDown={onKeyDown}
        className={cn(
          "grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]",
          // toolbar · [pane search bar] · content · [window path footer]
          isWindow && mode === "tree"
            ? "grid-rows-[auto_minmax(0,1fr)_auto]"
            : !isWindow && searchOpen
              ? "grid-rows-[auto_auto_minmax(0,1fr)]"
              : "grid-rows-[auto_minmax(0,1fr)]",
        )}
      >
        <div role="toolbar" aria-label="Response body view" className={cn("flex min-w-0 items-center gap-1 border-b border-line", isWindow ? "h-10 gap-2 px-3" : "h-8 px-2")}>
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={modes}
            aria-label="View as"
            className="flex-none"
          />
          {isWindow ? searchBar : <span className="flex-1" />}
          {!isWindow && (
            <ToolbarButton label="Search" hint={`${MOD}F`} pressed={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())}>
              <Search />
            </ToolbarButton>
          )}
          {mode === "tree" && (
            <>
              <ToolbarButton label="Expand all" onClick={() => treeRef.current?.expandAll()}>
                <ChevronsUpDown />
              </ToolbarButton>
              <ToolbarButton label="Collapse all" onClick={() => treeRef.current?.collapseAll()}>
                <ChevronsDownUp />
              </ToolbarButton>
            </>
          )}
          {mode === "table" && (
            <ToolbarButton label="Copy table as CSV" onClick={() => void copyWithToast(table.csv(), "Table copied as CSV.")}>
              <FileSpreadsheet />
            </ToolbarButton>
          )}
          <ToolbarButton label="Copy body" onClick={() => void copyWithToast(mode === "raw" || !isJson ? rawText : prettyJsonCached(rawText), "Body copied.")}>
            <Copy />
          </ToolbarButton>
          {onOpenWindow && (
            <ToolbarButton label="Open in new window" onClick={onOpenWindow}>
              <ExternalLink />
            </ToolbarButton>
          )}
        </div>

        {!isWindow && searchOpen && <div className="flex h-[34px] animate-fade-in items-center border-b border-line px-2">{searchBar}</div>}

        {mode === "table" && table.list ? (
          <TableView key={rawText} table={table} query={query} activeMatch={active} />
        ) : mode === "tree" && parsed.ok ? (
          <JsonTree
            key={rawText}
            ref={treeRef}
            root={parsed.value}
            search={treeSearch}
            query={query}
            activeMatch={active}
            onSelect={setSelectedPath}
          />
        ) : text.length > VIRTUALIZE_ABOVE ? (
          <VirtualCode
            key={mode}
            text={text}
            json={mode === "pretty" && isJson}
            ranges={ranges}
            activeMatch={count ? active : -1}
            layout={mode === "raw" ? "raw" : "pretty"}
          />
        ) : (
          <div className="min-h-0 overflow-auto">
            <JsonViewer text={text} json={mode === "pretty" && isJson} ranges={ranges} activeMatch={count ? active : -1} layout={mode === "raw" ? "raw" : "pretty"} />
          </div>
        )}

        {isWindow && mode === "tree" && <PathFooter path={selectedPath} />}
      </div>
    </TooltipProvider>
  );
}

/** Window footer: the selected node's path, with a copy button. */
function PathFooter({ path }: { path: JsonPath | null }) {
  const shown = path ? displayPath(path) : null;
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 border-t border-line px-3 text-[11.5px] text-fg3">
      {shown ? (
        <>
          <span className="flex-none">Path</span>
          <span className="min-w-0 truncate font-mono text-fg2 select-text" title={shown}>
            {shown}
          </span>
          <ToolbarButton label="Copy path" className="size-5 [&_svg]:size-3" onClick={() => void copyWithToast(shown, "Path copied.")}>
            <Copy />
          </ToolbarButton>
        </>
      ) : (
        "Select a row to see its path."
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
