import { AlertTriangle, CircleAlert, RefreshCw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { useWorkspaceActions } from "./useWorkspaceActions";

/**
 * "2 files need attention": files in the workspace folder that couldn't be
 * loaded (a merge conflict, invalid JSON) or were fixed up on load.
 */
export function ProblemsButton({ className }: { className?: string }) {
  const ws = useWorkspace();
  const actions = useWorkspaceActions();
  const problems = ws.problems;
  if (problems.length === 0) return null;
  const errors = problems.filter((p) => p.severity === "error").length;
  const label = `${problems.length} file${problems.length === 1 ? "" : "s"} need${problems.length === 1 ? "s" : ""} attention`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[11.5px] whitespace-nowrap hover:bg-bg2",
            errors ? "text-err" : "text-warn",
            className,
          )}
        >
          {errors ? <CircleAlert className="size-3.5" strokeWidth={2} /> : <AlertTriangle className="size-3.5" strokeWidth={2} />}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(460px,calc(100vw-24px))] rounded-lg border-0 bg-bg1 p-0 text-[12.5px] text-fg shadow-pop">
        <div className="border-b border-line px-3 py-2.5">
          <div className="font-medium">{label}</div>
          <div className="mt-0.5 text-[12px] leading-normal text-fg3">
            {errors > 0
              ? "Satchel skipped these files and won't overwrite them. Fix them (e.g. resolve the merge conflict) and the workspace reloads by itself."
              : "These files were loaded with a fix-up. Saving writes the fixed version."}
          </div>
        </div>
        <ul className="max-h-[260px] overflow-auto py-1">
          {problems.map((p) => (
            <li key={`${p.path}:${p.message}`} className="grid grid-cols-[16px_1fr] gap-2 px-3 py-1.5">
              {p.severity === "error" ? (
                <CircleAlert className="mt-0.5 size-3.5 text-err" strokeWidth={2} />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 text-warn" strokeWidth={2} />
              )}
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12px] text-fg" title={p.path}>
                  {p.path}
                </span>
                <span className="text-fg3">{p.message}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex border-t border-line px-2 py-1.5">
          <button
            type="button"
            onClick={() => void actions.reload()}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-fg2 hover:bg-bg2 hover:text-fg"
          >
            <RefreshCw className="size-3.5" strokeWidth={2} />
            Reload from disk
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
