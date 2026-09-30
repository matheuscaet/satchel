import type { ComponentProps, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useSessionCore, ENVIRONMENTS_TAB } from "@/state/session";
import { useCopyAsCurl } from "@/features/curl/useCopyAsCurl";

function Item({ className, ...props }: ComponentProps<typeof ContextMenuItem>) {
  return (
    <ContextMenuItem
      className={cn(
        "h-7 gap-2 rounded-[5px] px-2 py-0 text-[13px] whitespace-nowrap text-fg2 focus:bg-bg3 focus:text-fg data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

/** Right-click on a tab: close it, the others, the ones to its right, or all; copy a request as cURL. */
export function TabContextMenu({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[210px] rounded-lg border-0 bg-bg1 p-1 text-[13px] text-fg shadow-pop">
        <TabMenuItems id={id} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Mounted only while the menu is open, so the tabs don't subscribe to the session and workspace. */
function TabMenuItems({ id }: { id: string }) {
  const session = useSessionCore();
  const copyAsCurl = useCopyAsCurl();
  const tabs = session.tabs;
  const index = tabs.indexOf(id);
  const isRequest = id !== ENVIRONMENTS_TAB;

  return (
    <>
      <Item onSelect={() => session.closeTab(id)}>Close</Item>
      <Item disabled={tabs.length < 2} onSelect={() => session.closeOtherTabs(id)}>
        Close others
      </Item>
      <Item disabled={index < 0 || index === tabs.length - 1} onSelect={() => session.closeTabsToRight(id)}>
        Close to the right
      </Item>
      <Item onSelect={() => session.closeAllTabs()}>Close all</Item>
      {isRequest && (
        <>
          <ContextMenuSeparator className="mx-0.5 my-1 bg-line" />
          <Item onSelect={() => copyAsCurl(id)}>Copy as cURL</Item>
          <Item onSelect={() => copyAsCurl(id, { resolve: false })}>
            Copy as cURL <span className="text-fg3">with {"{{variables}}"}</span>
          </Item>
        </>
      )}
    </>
  );
}
