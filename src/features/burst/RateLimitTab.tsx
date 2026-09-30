import { useId, useState } from "react";
import { useSessionCore, useSessionRuns } from "@/state/session";
import { useWorkspace } from "@/state/workspace";
import { Checkmark } from "@/components/common/Checkmark";
import { cn } from "@/lib/utils";

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(Math.round(n), min), max);

interface NumFieldProps {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** Bordered number box with a unit suffix (the mockup's `.num`). Clamps as you type; restores on blur. */
function NumField({ label, suffix, value, min, max, disabled, onChange }: NumFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-xs text-fg3">
        {label}
      </label>
      <div className="flex h-8 items-center overflow-hidden rounded-md border border-line2 bg-bg0 focus-within:border-brass-line has-disabled:opacity-60">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(clamp(n, min, max));
          }}
          onBlur={() => setDraft(null)}
          className="h-[30px] min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] leading-[30px] outline-none"
        />
        <span className="border-l border-line px-2.5 text-xs leading-[30px] text-fg3">{suffix}</span>
      </div>
    </div>
  );
}

/** The request pane's "Rate Limit" tab: configure and start a burst. */
export function RateLimitTab({ requestId }: { requestId: string }) {
  const { burstConfig: c, setBurstConfig, startBurstRun, stopBurstRun } = useSessionCore();
  const running = !!useSessionRuns().bursts[requestId]?.running;
  const { activeEnvironment } = useWorkspace();
  const total = c.rps * c.seconds;

  return (
    <div>
      <div className="flex h-[34px] items-center px-3 pt-1.5 text-[11px] font-medium tracking-[0.04em] text-fg3 uppercase">
        Burst test
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,150px))] gap-x-3.5 gap-y-3 px-3 pt-1 pb-3">
        <NumField
          label="Requests per second"
          suffix="req/s"
          value={c.rps}
          min={1}
          max={200}
          disabled={running}
          onChange={(rps) => setBurstConfig({ ...c, rps })}
        />
        <NumField
          label="Duration"
          suffix="s"
          value={c.seconds}
          min={1}
          max={60}
          disabled={running}
          onChange={(seconds) => setBurstConfig({ ...c, seconds })}
        />
        {/* the Checkmark is a <button>, which a <label> activates natively when its text is clicked */}
        <label className={cn("col-span-full flex w-max cursor-pointer items-center gap-2 text-[12.5px] text-fg2", running && "cursor-default opacity-60")}>
          <Checkmark
            checked={c.stopAtFirst429}
            onChange={(stopAtFirst429) => !running && setBurstConfig({ ...c, stopAtFirst429 })}
            className={running ? "pointer-events-none" : undefined}
          />
          Stop at the first 429
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 px-3 pb-3">
        <button
          type="button"
          onClick={() => (running ? stopBurstRun(requestId) : startBurstRun(requestId))}
          className="h-[30px] rounded-md border border-brass-line px-3.5 font-medium text-fg hover:bg-brass-soft"
        >
          {running ? "Stop" : "Run burst"}
        </button>
        <span className="text-xs leading-normal text-fg3">
          {total} requests to the resolved URL{activeEnvironment ? ` in ${activeEnvironment.name}` : ""}
        </span>
      </div>
      <div className="px-3 pb-3 text-xs leading-normal text-fg3">
        Logs status, latency, <span className="font-mono">X-RateLimit-*</span> and <span className="font-mono">Retry-After</span> for
        every request. Results open in the response pane.
      </div>
    </div>
  );
}
