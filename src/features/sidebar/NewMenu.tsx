import { useRef } from "react";
import { Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MOD } from "@/components/common/Kbd";
import { MenuContent, MenuItem, MenuSeparator } from "@/features/shell/menu";
import { IconButton } from "@/features/shell/IconButton";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";

interface NewMenuProps {
  /** Start inline-renaming a node that was just created */
  onCreated: (id: string) => void;
}

/** The sidebar's "+" menu: create or import. */
export function NewMenu({ onCreated }: NewMenuProps) {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const actions = useAppActions();
  // When an item was chosen, focus belongs to whatever it opened (URL field, rename input), not the "+" button.
  const chose = useRef(false);
  const pick = (run: () => void) => () => {
    chose.current = true;
    run();
  };

  // New folders go into the collection of the open request, else the first one.
  const targetCollectionId = () => {
    const active = session.activeTab ? ws.findRequest(session.activeTab) : undefined;
    return active?.collection.id ?? ws.workspace.collections[0]?.id ?? ws.addCollection("My requests");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton title="New or import" aria-label="New or import">
          <Plus className="size-[13px]" strokeWidth={2.2} />
        </IconButton>
      </DropdownMenuTrigger>
      <MenuContent
        align="start"
        onCloseAutoFocus={(e) => {
          if (chose.current) e.preventDefault();
          chose.current = false;
        }}
      >
        <MenuItem
          kbd={`${MOD}N`}
          onSelect={pick(() => {
            actions.newRequest();
            ui.setSidebarOpen(false);
          })}
        >
          New request
        </MenuItem>
        <MenuItem onSelect={pick(() => onCreated(ws.addFolder(targetCollectionId())))}>New folder</MenuItem>
        <MenuItem onSelect={pick(() => onCreated(ws.addCollection()))}>New collection</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={pick(() => void actions.pasteCurlFromClipboard())}>Paste cURL</MenuItem>
        <MenuItem onSelect={pick(() => ui.openPostmanDialog())}>Import Postman collection…</MenuItem>
      </MenuContent>
    </DropdownMenu>
  );
}
