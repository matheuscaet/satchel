import { useEffect } from "react";
import { Menu, Moon, Search, Sun } from "lucide-react";
import { toast } from "sonner";
import { Kbd, MOD } from "@/components/common/Kbd";
import { EnvironmentPill } from "@/features/environments/EnvironmentPill";
import { useWorkspace } from "@/state/workspace";
import { useUi } from "@/state/ui";
import { useTheme } from "@/state/theme";
import { BagMark } from "./BagMark";
import { IconButton } from "./IconButton";
import { WorkspaceFileMenu } from "./WorkspaceFileMenu";

/** 44px app header: brand, workspace file, search, environment, theme. */
export function AppHeader() {
  const ui = useUi();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="grid grid-cols-[var(--sidebar-w,256px)_minmax(0,1fr)_auto] items-center border-b border-line bg-bg0 max-[820px]:grid-cols-[auto_minmax(0,1fr)_auto]">
      <WorkspaceErrors />
      <div className="flex h-full items-center gap-2 border-r border-line px-3.5 font-semibold tracking-[-0.01em] max-[820px]:border-r-0">
        <IconButton
          className="min-[820px]:hidden"
          aria-label="Collections"
          aria-expanded={ui.sidebarOpen}
          onClick={() => ui.setSidebarOpen(!ui.sidebarOpen)}
        >
          <Menu className="size-[15px]" strokeWidth={2} />
        </IconButton>
        <BagMark size={18} className="shrink-0 text-brass" />
        Satchel
      </div>

      <div className="flex min-w-0 items-center gap-2.5 px-3">
        <WorkspaceFileMenu />
        <button
          type="button"
          onClick={() => ui.setPaletteOpen(true)}
          aria-label="Search requests and commands"
          className="mx-auto flex h-7 w-[min(340px,40vw)] cursor-pointer items-center gap-2 rounded-md border border-line bg-bg1 pr-1.5 pl-2.5 text-fg3 hover:border-line2 hover:text-fg2 max-[820px]:mr-0 max-[820px]:w-auto"
        >
          <Search className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="flex-1 truncate text-left max-[820px]:hidden">Search requests and commands</span>
          <Kbd>{`${MOD}K`}</Kbd>
        </button>
      </div>

      <div className="flex items-center gap-1 pr-2.5">
        <EnvironmentPill />
        <IconButton title="Light / dark" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="size-[15px]" strokeWidth={2} /> : <Moon className="size-[15px]" strokeWidth={2} />}
        </IconButton>
      </div>
    </header>
  );
}

/** Surfaces file/IO errors once, then clears them. Its own component: it watches the workspace, the header doesn't. */
function WorkspaceErrors() {
  const { error, clearError } = useWorkspace();
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    clearError();
  }, [error, clearError]);
  return null;
}
