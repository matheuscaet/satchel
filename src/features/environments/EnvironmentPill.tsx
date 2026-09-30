import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EnvDot } from "@/components/common/EnvDot";
import { MOD } from "@/components/common/Kbd";
import { MenuContent, MenuHead, MenuItem, MenuSeparator } from "@/features/shell/menu";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";
import { cn } from "@/lib/utils";

/** Header pill showing the active environment; opens the switch menu. */
export function EnvironmentPill() {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const actions = useAppActions();
  const environments = ws.workspace.environments;
  const active = ws.activeEnvironment;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Active environment"
          className="flex h-7 min-w-0 cursor-pointer items-center gap-[7px] rounded-md border border-line2 pr-[9px] pl-2.5 font-medium whitespace-nowrap hover:bg-bg2 data-[state=open]:bg-bg2"
        >
          <EnvDot color={active?.color} />
          <span className="font-normal text-fg3">Env</span>
          <span className="max-w-[180px] truncate">{active?.name ?? "No environment"}</span>
          <ChevronDown className="size-2.5 text-fg3" strokeWidth={2.4} />
        </button>
      </DropdownMenuTrigger>
      <MenuContent align="end">
        <MenuHead>Active environment</MenuHead>
        {environments.length === 0 && <div className="px-2 pb-1.5 text-[12.5px] text-fg3">No environments yet</div>}
        {environments.map((env, i) => (
          <MenuItem
            key={env.id}
            kbd={i < 9 ? `${MOD}${i + 1}` : undefined}
            className={cn(env.id === active?.id && "bg-bg3 text-fg")}
            onSelect={() => actions.switchEnvironment(env.id)}
          >
            <EnvDot color={env.color} />
            <span className="max-w-[220px] truncate">{env.name}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => ui.openEnvironmentDialog({ mode: "create" })}>New environment…</MenuItem>
        <MenuItem onSelect={() => session.openEnvironments()}>Edit environments…</MenuItem>
      </MenuContent>
    </DropdownMenu>
  );
}
