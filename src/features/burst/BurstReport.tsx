import { memo, useMemo, type ReactNode } from "react";
import type { BurstRun } from "@/state/session";
import type { BurstResult } from "@/http/burst";
import { cn } from "@/lib/utils";
import { BurstChart } from "./BurstChart";
import { summarizeBurst, type BurstSummary } from "./burstMath";

/** Rows rendered in the log; a 200 req/s × 60 s run would otherwise mount 12k rows. */
const LOG_LIMIT = 400;

/** Burst results in the response pane: stats, chart, and the per-request log. Loaded lazily by BurstPanel. */
export function BurstReport({ run }: { run: BurstRun }) {
  const summary = useMemo(() => summarizeBurst(run.results), [run.results]);
  return (
    <div>
      <BurstStats summary={summary} running={run.running} />
      <BurstChart results={run.results} seconds={run.config.seconds} total={run.total} />
      <BurstLog results={run.results} firstSeq={summary.first429?.seq ?? null} />
    </div>
  );
}

function Stat({ label, tone, children }: { label: string; tone?: "ok" | "err"; children: ReactNode }) {
  return (
    <span>
      {label}
      <b className={cn("ml-[5px] font-mono text-[12.5px] font-medium text-fg", tone === "ok" && "text-ok", tone === "err" && "text-err")}>
        {children}
      </b>
    </span>
  );
}

const ms = (n: number | null) => (n === null ? "—" : `${n} ms`);

function BurstStats({ summary: s, running }: { summary: BurstSummary; running: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-[18px] gap-y-1 border-b border-line px-3 py-2.5 text-xs text-fg3">
      <Stat label="Sent">{s.sent}</Stat>
      <Stat label="2xx" tone="ok">
        {s.ok}
      </Stat>
      <Stat label="429" tone={s.limited ? "err" : undefined}>
        {s.limited}
      </Stat>
      {s.other > 0 && (
        <Stat label="Other" tone="err">
          {s.other}
        </Stat>
      )}
      {s.errors > 0 && (
        <Stat label="Errors" tone="err">
          {s.errors}
        </Stat>
      )}
      <Stat label="p50">{ms(s.p50)}</Stat>
      <Stat label="p95">{ms(s.p95)}</Stat>
      <Stat label="First 429" tone={s.first429 ? "err" : undefined}>
        {s.first429 ? `#${s.first429.seq} at ${s.first429.t.toFixed(2)}s` : running ? "…" : "none"}
      </Stat>
    </div>
  );
}

const TH = "sticky top-0 border-b border-line bg-bg1 px-2.5 py-1.5 text-left font-sans text-[11px] font-medium text-fg3 shadow-[inset_0_-1px_0_var(--line)]";
const TD = "border-b border-line px-2.5 py-1";

function statusClass(status: number | null): string {
  if (status === null) return "text-err";
  if (status >= 200 && status < 300) return "text-ok";
  if (status >= 400) return "text-err";
  return "";
}

function BurstLog({ results, firstSeq }: { results: BurstResult[]; firstSeq: number | null }) {
  const rows = useMemo(() => results.slice(-LOG_LIMIT).reverse(), [results]);
  const hidden = results.length - rows.length;
  return (
    <table className="w-full border-collapse font-mono text-xs text-fg2">
      <thead>
        <tr>
          {["#", "t", "Status", "Latency", "Remaining", "Retry-After"].map((h) => (
            <th key={h} className={TH}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <LogRow key={r.seq} result={r} first={r.seq === firstSeq} />
        ))}
        {hidden > 0 && (
          <tr>
            <td colSpan={6} className={cn(TD, "font-sans text-fg3")}>
              Showing the latest {rows.length} of {results.length} requests.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// Results never change once reported, so rows re-render only when they're new (the log updates while a run reports).
const LogRow = memo(function LogRow({ result: r, first }: { result: BurstResult; first: boolean }) {
  const td = cn(TD, first && "bg-err-soft");
  return (
    <tr>
      <td className={td}>{r.seq}</td>
      <td className={td}>{r.t.toFixed(2)}s</td>
      <td className={cn(td, statusClass(r.status))}>{r.status ?? "ERR"}</td>
      <td className={td}>{r.ms} ms</td>
      {r.status === null ? (
        <td colSpan={2} className={cn(td, "max-w-0 truncate font-sans text-fg3")} title={r.error}>
          {r.error ?? "Request failed"}
        </td>
      ) : (
        <>
          <td className={td}>{r.remaining ?? "—"}</td>
          <td className={td}>{r.retryAfter ?? "—"}</td>
        </>
      )}
    </tr>
  );
});
