import { memo, useEffect, useRef, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import type { HttpMethod } from "@/types";
import { useSessionCore, ENVIRONMENTS_TAB } from "@/state/session";
import { useAppActions } from "@/state/actions";
import { Tab } from "./Tab";
import { TabContextMenu } from "./TabContextMenu";

/** 36px strip of open tabs (requests + the Environments tab) with a trailing "+". */
export function TabStrip() {
  const ws = useWorkspace();
  const session = useSessionCore();
  const actions = useAppActions();
  const stripRef = useRef<HTMLDivElement>(null);
  const active = session.activeTab;

  const tabEl = (id: string) => stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);

  useEffect(() => {
    if (active) tabEl(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, session.tabs.length]);

  // ←/→ between tabs when one has focus
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = session.tabs;
    if (tabs.length === 0) return;
    const i = active ? tabs.indexOf(active) : -1;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    e.preventDefault();
    session.setActiveTab(next);
    requestAnimationFrame(() => tabEl(next)?.focus());
  };

  return (
    <div ref={stripRef} className="flex items-stretch overflow-x-auto border-b border-line bg-bg0 scrollbar-none">
      <div role="tablist" aria-label="Open tabs" className="flex items-stretch" onKeyDown={onKeyDown}>
        {session.tabs.map((id) => {
          if (id === ENVIRONMENTS_TAB) {
            return (
              <StripTab key={id} id={id} label="Environments" active={id === active} onSelect={session.setActiveTab} onClose={session.closeTab} />
            );
          }
          const request = ws.findRequest(id)?.request;
          if (!request) return null;
          return (
            <StripTab
              key={id}
              id={id}
              label={request.name}
              method={request.method}
              active={id === active}
              onSelect={session.setActiveTab}
              onClose={session.closeTab}
            />
          );
        })}
      </div>
      <button
        type="button"
        title="New request"
        aria-label="New request"
        onClick={() => actions.newRequest()}
        className="grid w-[34px] flex-none cursor-pointer place-items-center text-fg3 hover:text-fg"
      >
        <Plus className="size-[13px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}

interface StripTabProps {
  id: string;
  label: string;
  method?: HttpMethod;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/** A tab with its context menu; re-renders only when its own label, method or state changes. */
const StripTab = memo(function StripTab({ id, label, method, active, onSelect, onClose }: StripTabProps) {
  return (
    <TabContextMenu id={id}>
      <Tab id={id} label={label} method={method} active={active} onSelect={() => onSelect(id)} onClose={() => onClose(id)} />
    </TabContextMenu>
  );
});
