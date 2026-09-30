import type { ComponentProps } from "react";
import { Layers, X } from "lucide-react";
import type { HttpMethod } from "@/types";
import { MethodLabel } from "@/components/common/MethodLabel";
import { cn } from "@/lib/utils";

interface TabProps extends Omit<ComponentProps<"div">, "onSelect"> {
  id: string;
  label: string;
  /** Request method; omitted for the Environments tab (layers icon) */
  method?: HttpMethod;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** One tab in the strip: method + name, brass top line when active, close on hover/active/middle-click. */
export function Tab({ id, label, method, active, onSelect, onClose, className, ...rest }: TabProps) {
  // `rest` carries what a wrapping trigger adds (the tab context menu's ref, onContextMenu, data-state).
  return (
    <div
      {...rest}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-tab-id={id}
      title={label}
      onClick={onSelect}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault(); // no autoscroll on middle-click
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete") {
          e.preventDefault();
          onClose();
        }
      }}
      className={cn(
        className,
        "group relative flex max-w-[210px] flex-none cursor-pointer items-center gap-[7px] border-r border-line pr-2 pl-3 whitespace-nowrap text-fg3 select-none hover:bg-bg1 hover:text-fg2 focus-visible:[outline-offset:-1.5px]",
        active &&
          "bg-bg1 text-fg hover:text-fg before:absolute before:inset-x-0 before:top-0 before:h-[1.5px] before:bg-brass after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-bg1",
      )}
    >
      {method ? <MethodLabel method={method} /> : <Layers className="size-3.5 shrink-0 text-fg3" strokeWidth={1.9} aria-hidden />}
      <span className="truncate">{label}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "grid size-[18px] flex-none cursor-pointer place-items-center rounded-sm text-fg3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-bg3 hover:text-fg",
          active && "opacity-100",
        )}
      >
        <X className="size-2.5" strokeWidth={2.8} />
      </button>
    </div>
  );
}
