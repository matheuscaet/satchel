import { useMemo } from "react";
import { mergedVariables, type VariableContext } from "@/variables";
import { cn } from "@/lib/utils";
import { resolvedUrlSegments, resolverFor } from "@/features/variables/segments";

const TOKEN = "cursor-help border-b border-dotted";
/** Secret values never show in the line; hovering still tells where they come from. */
const MASK = "••••••••";

/** "→ https://…" under the URL bar: every substituted value is hoverable for its provenance. */
export function ResolvedUrl({ url, pathVariables, context }: { url: string; pathVariables?: Record<string, string>; context: VariableContext }) {
  const segments = useMemo(
    () => resolvedUrlSegments(url, pathVariables, resolverFor(mergedVariables(context))),
    [url, pathVariables, context],
  );
  const secrets = useMemo(() => {
    const all = [...(context.environment?.variables ?? []), ...(context.collection?.variables ?? []), ...context.globals];
    return new Set(all.filter((v) => v.secret).map((v) => v.key));
  }, [context]);
  return (
    <div className="mt-1.5 flex items-baseline gap-1.5 overflow-hidden pl-[104px] font-mono text-[11.5px] whitespace-nowrap text-fg3 max-[820px]:pl-0.5">
      <span>→</span>
      <span>
        {segments.map((s, i) => {
          if (s.kind === "text") return <span key={i}>{s.text}</span>;
          const missing = s.value === undefined;
          const cls = cn(TOKEN, missing ? "border-err text-err" : "border-fg3 text-fg2");
          if (s.kind === "var")
            return (
              <span key={i} data-resolved-token data-var={s.key} className={cls}>
                {missing ? `{{${s.key}}}` : secrets.has(s.key) ? MASK : s.value}
              </span>
            );
          return (
            <span key={i} data-resolved-token data-pp={s.name} className={cls}>
              {missing ? `:${s.name}` : s.value}
            </span>
          );
        })}
      </span>
    </div>
  );
}
