import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Search } from "lucide-react";
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Kbd, MOD } from "@/components/common/Kbd";
import { MethodLabel } from "@/components/common/MethodLabel";
import { useUi } from "@/state/ui";
import { groupRanked, rankItems } from "./rank";
import { usePaletteItems, type PaletteItem } from "./usePaletteItems";

/** ⌘K: jump to a request (↵ open, ⌘↵ open and send) or run a command. */
export function CommandPalette() {
  const ui = useUi();
  return (
    <Dialog open={ui.paletteOpen} onOpenChange={ui.setPaletteOpen}>
      <DialogPortal>
        <DialogOverlay className="animate-fade-in bg-[var(--scrim)]" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 animate-fade-in overflow-hidden rounded-xl bg-bg1 shadow-pop outline-none"
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">Jump to a request, switch environment, or run a command.</DialogDescription>
          <PaletteBody />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/**
 * The palette's contents, mounted only while it's open: the items (every
 * request in the workspace) are built here, not on each render of the app, and
 * each opening starts with an empty query.
 */
function PaletteBody() {
  const ui = useUi();
  const items = usePaletteItems();
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");

  const groups = useMemo(() => groupRanked(rankItems(items, query)), [items, query]);
  const firstId = groups[0]?.items[0]?.id ?? "";

  // Typing moves the highlight back to the top result.
  useEffect(() => {
    setValue(firstId);
    // Only on query changes, not when the item list re-renders.
  }, [query]);

  const run = (item: PaletteItem | undefined, send: boolean) => {
    if (!item) return;
    ui.setPaletteOpen(false);
    item.run(send);
  };
  const byId = (id: string) => groups.flatMap((g) => g.items).find((i) => i.id === id);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      run(byId(value), true);
    }
  };

  return (
    <CommandPrimitive
      shouldFilter={false}
      vimBindings={false}
      loop={false}
      value={value}
      onValueChange={setValue}
      onKeyDown={onKeyDown}
      label="Command palette"
      className="flex flex-col outline-none"
    >
      <div className="flex h-[46px] items-center gap-2.5 border-b border-line px-3.5 text-fg3">
        <Search className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <CommandPrimitive.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to a request, switch environment, run a command…"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] leading-[44px] text-fg outline-none placeholder:text-fg3"
        />
        <Kbd>esc</Kbd>
      </div>

      <CommandPrimitive.List className="max-h-[min(380px,55vh)] overflow-auto p-1.5">
        {groups.length === 0 && (
          <div className="p-3.5 text-[11px] text-fg3">Nothing matches. Try a URL path, method, or command.</div>
        )}
        {groups.map((g) => (
          <CommandPrimitive.Group
            key={g.group}
            heading={g.group}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-fg3"
          >
            {g.items.map((item) => (
              <PaletteRow key={item.id} item={item} onRun={() => run(item, false)} />
            ))}
          </CommandPrimitive.Group>
        ))}
      </CommandPrimitive.List>

      <div className="flex gap-3.5 border-t border-line px-3.5 py-2 text-[11.5px] text-fg3">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </span>
        <span>
          <Kbd>↵</Kbd> open
        </span>
        <span>
          <Kbd>{`${MOD}↵`}</Kbd> open and send
        </span>
      </div>
    </CommandPrimitive>
  );
}

function PaletteRow({ item, onRun }: { item: PaletteItem; onRun: () => void }) {
  return (
    <CommandPrimitive.Item
      value={item.id}
      onSelect={onRun}
      className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-fg2 data-[selected=true]:bg-bg3 data-[selected=true]:text-fg"
    >
      {item.method ? (
        <MethodLabel method={item.method} className="w-11" />
      ) : (
        <span className="grid w-11 flex-none justify-items-start text-fg3">{item.icon}</span>
      )}
      <span className="max-w-[65%] flex-none truncate">{item.label}</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-fg3">{item.sub}</span>
    </CommandPrimitive.Item>
  );
}
