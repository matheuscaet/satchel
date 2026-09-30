import type { KeyValue, SatchelRequest } from "@/types";
import { buildUrl } from "@/requestBuilder";
import { buildInit, doFetch } from "./send";
import { errorMessage } from "@/lib/errors";

export interface BurstConfig {
  /** requests per second, 1–200 */
  rps: number;
  /** seconds, 1–60 */
  seconds: number;
  stopAtFirst429: boolean;
}

export interface BurstResult {
  seq: number;
  /** seconds since the run started, when this request was sent */
  t: number;
  status: number | null;
  ok: boolean;
  ms: number;
  /** X-RateLimit-Remaining / RateLimit-Remaining, when the server sends one */
  remaining: number | null;
  /** X-RateLimit-Limit / RateLimit-Limit */
  limit: number | null;
  /** Retry-After, as sent */
  retryAfter: string | null;
  rateLimitHeaders: [string, string][];
  error?: string;
}

// Rate-limit header names vary by API (X-RateLimit-*, RateLimit-*, Retry-After…) — match loosely.
const RATE_HEADER_RE = /rate.?limit|retry-after/i;

function headerNumber(headers: Headers, suffix: "remaining" | "limit"): number | null {
  for (const name of [`x-ratelimit-${suffix}`, `ratelimit-${suffix}`, `x-rate-limit-${suffix}`]) {
    const v = headers.get(name);
    if (v !== null && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Fire `rps` requests per second for `seconds`. Results arrive out of order
 * via onResult; onDone fires once when the schedule ends (in-flight requests
 * may still report afterwards). Returns a stop function.
 */
export function startBurst(
  request: SatchelRequest,
  variables: KeyValue[],
  config: BurstConfig,
  onResult: (r: BurstResult) => void,
  onDone: () => void,
): () => void {
  const rps = Math.min(Math.max(Math.round(config.rps), 1), 200);
  const seconds = Math.min(Math.max(Math.round(config.seconds), 1), 60);
  const total = rps * seconds;
  const controller = new AbortController();
  let running = true;
  let sent = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const startTime = performance.now();
  const intervalMs = 1000 / rps;

  const stop = () => {
    if (!running) return;
    running = false;
    if (timer) clearTimeout(timer);
    controller.abort();
    onDone();
  };

  const fireOne = async (seq: number) => {
    const sentAt = performance.now();
    const t = (sentAt - startTime) / 1000;
    try {
      const url = buildUrl(request, variables);
      const init = await buildInit(request, variables, controller.signal);
      const res = await doFetch()(url, init);
      try {
        res.body?.cancel?.().catch(() => {});
      } catch {
        // stream cancellation unsupported — harmless
      }
      if (!running && controller.signal.aborted) return;
      const result: BurstResult = {
        seq,
        t,
        status: res.status,
        ok: res.ok,
        ms: Math.round(performance.now() - sentAt),
        remaining: headerNumber(res.headers, "remaining"),
        limit: headerNumber(res.headers, "limit"),
        retryAfter: res.headers.get("retry-after"),
        rateLimitHeaders: Array.from(res.headers.entries()).filter(([k]) => RATE_HEADER_RE.test(k)),
      };
      onResult(result);
      if (config.stopAtFirst429 && res.status === 429) stop();
    } catch (err) {
      if (controller.signal.aborted) return;
      onResult({
        seq, t, status: null, ok: false, ms: Math.round(performance.now() - sentAt),
        remaining: null, limit: null, retryAfter: null, rateLimitHeaders: [],
        error: errorMessage(err, "Request failed"),
      });
    }
  };

  // A background window gets its timers throttled (~1 tick/sec). Fire every
  // request that has come due since the last tick, so a late tick catches up
  // instead of silently lowering the rate for the rest of the run.
  const tick = () => {
    if (!running) return;
    const elapsed = performance.now() - startTime;
    const due = Math.min(total, Math.floor(elapsed / intervalMs) + 1);
    while (sent < due) fireOne(++sent);
    if (sent >= total) {
      running = false;
      onDone();
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };
  tick();
  return stop;
}
