import type { ReactNode } from "react";
import type { SatchelRequest } from "@/types";
import type { VariableContext } from "@/variables";
import { useSessionCore, type RequestTab } from "@/state/session";
import { pathParamNames } from "@/url";
import { cn } from "@/lib/utils";
import { onDemand } from "@/features/shell/onDemand";
import { ParamsTab } from "./ParamsTab";
import { HeadersTab } from "./HeadersTab";
import { AuthTab } from "./AuthTab";
import { BodyTab } from "./body/BodyTab";

interface RequestPaneProps {
  request: SatchelRequest;
  context: VariableContext;
  update: (updater: (r: SatchelRequest) => SatchelRequest) => void;
}

const RateLimitTab = onDemand(() => import("@/features/burst/RateLimitTab").then((m) => m.RateLimitTab));

const AUTH_TAG = { bearer: "Bearer", basic: "Basic", apikey: "Key" } as const;

function bodyTag(body: SatchelRequest["body"]): string | undefined {
  if (body.mode === "raw") return body.language === "json" ? "JSON" : body.language.toUpperCase();
  if (body.mode === "formdata") return "Form";
  if (body.mode === "urlencoded") return "URL-enc";
  return undefined;
}

/** Left pane of the request view: Params / Headers / Body / Auth / Rate Limit. */
export function RequestPane({ request, context, update }: RequestPaneProps) {
  const session = useSessionCore();
  const tab = session.requestTab(request.id, request);
  const paramCount = request.params.filter((p) => p.enabled && p.key).length + pathParamNames(request.url).length;
  const headerCount = request.headers.filter((h) => h.enabled && h.key).length;

  const tabs: { id: RequestTab; label: string; tag?: string | number }[] = [
    { id: "params", label: "Params", tag: paramCount || undefined },
    { id: "headers", label: "Headers", tag: headerCount || undefined },
    { id: "body", label: "Body", tag: bodyTag(request.body) },
    { id: "auth", label: "Auth", tag: request.auth.type !== "none" ? AUTH_TAG[request.auth.type] : undefined },
    { id: "rate", label: "Rate Limit" },
  ];

  let content: ReactNode;
  if (tab === "params") content = <ParamsTab request={request} context={context} update={update} />;
  else if (tab === "headers") content = <HeadersTab request={request} context={context} update={update} />;
  else if (tab === "body") content = <BodyTab request={request} context={context} update={update} />;
  else if (tab === "auth") content = <AuthTab request={request} context={context} update={update} />;
  else content = <RateLimitTab requestId={request.id} />;

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[36px_minmax(0,1fr)]" aria-label="Request">
      <div role="tablist" aria-label="Request sections" className="flex items-stretch gap-0.5 overflow-x-auto border-b border-line px-2 scrollbar-none">
        {tabs.map((t) => (
          <SubTab key={t.id} active={tab === t.id} onClick={() => session.setRequestTab(request.id, t.id)} tag={t.tag}>
            {t.label}
          </SubTab>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 overflow-auto">
        {content}
      </div>
    </section>
  );
}

export function SubTab({ active, onClick, tag, children }: { active: boolean; onClick: () => void; tag?: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative flex flex-none items-center gap-[5px] px-2 whitespace-nowrap text-fg3 hover:text-fg",
        active && "text-fg after:absolute after:right-2 after:-bottom-px after:left-2 after:h-[1.5px] after:rounded-[2px] after:bg-brass",
      )}
    >
      {children}
      {tag !== undefined && <span className="text-[11px] text-fg3">{tag}</span>}
    </button>
  );
}
