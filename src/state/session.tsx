import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sendRequest, type HttpResponse } from "@/http/send";
import { startBurst, type BurstConfig, type BurstResult } from "@/http/burst";
import { mergedVariables, isResolved } from "@/variables";
import { VARIABLE_PATTERN } from "@/variableTokens";
import { pathParamNames } from "@/url";
import type { SatchelRequest } from "@/types";
import { useWorkspace } from "./workspace";
import { publishResponse } from "@/features/response/popout/transport";
import { snapshotOf } from "@/features/response/popout/snapshot";
import { errorMessage } from "@/lib/errors";
import { mergeBySeq } from "@/features/burst/burstMath";

/**
 * Runtime, per-window state that is NOT saved in the workspace file:
 * open tabs, which sub-tab each request shows, responses, burst runs.
 */

export const ENVIRONMENTS_TAB = "@environments";
export type TabId = string; // a request id, or ENVIRONMENTS_TAB

export type RequestTab = "params" | "headers" | "body" | "auth" | "rate";
export type ResponseTab = "body" | "headers" | "burst";

export type ResponseEntry =
  | { kind: "ok"; response: HttpResponse }
  | { kind: "error"; message: string };

export interface BurstRun {
  config: BurstConfig;
  total: number;
  running: boolean;
  results: BurstResult[]; // kept sorted by seq
  startedAt: number;
}

/** Why a send was held back, shown as an inline bar under the URL. */
export interface SendBlocker {
  requestId: string;
  /** {{variables}} that don't resolve in the active environment */
  missingVariables: string[];
}

/** Focus request for the environment matrix (e.g. "Define in Production"). */
export interface MatrixFocus {
  variable?: string;
  environmentId?: string;
  /** a just-created environment whose column should be highlighted */
  freshEnvironmentId?: string;
}

/**
 * Tabs, view state and actions. Split from the runs below so that a response
 * arriving (or a burst reporting) doesn't re-render everything that only
 * cares about tabs.
 */
interface SessionCore {
  tabs: TabId[];
  activeTab: TabId | null;
  openTab: (id: TabId) => void;
  closeTab: (id: TabId) => void;
  /** Close every tab except `id` (which becomes active). */
  closeOtherTabs: (id: TabId) => void;
  /** Close the tabs after `id` in the strip. */
  closeTabsToRight: (id: TabId) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: TabId) => void;

  requestTab: (requestId: string, request?: SatchelRequest) => RequestTab;
  setRequestTab: (requestId: string, tab: RequestTab) => void;
  setResponseTab: (requestId: string, tab: ResponseTab) => void;

  /** Sends the request. Unless force, holds back and sets `blocker` when {{variables}} are unresolved. */
  send: (requestId: string, opts?: { force?: boolean }) => void;
  cancel: (requestId: string) => void;
  blocker: SendBlocker | null;
  clearBlocker: () => void;

  burstConfig: BurstConfig;
  setBurstConfig: (config: BurstConfig) => void;
  startBurstRun: (requestId: string) => void;
  stopBurstRun: (requestId: string) => void;

  matrixFocus: MatrixFocus | null;
  /** Open the Environments tab, optionally focusing a cell */
  openEnvironments: (focus?: MatrixFocus) => void;
  clearMatrixFocus: () => void;

  /** Bumped on every environment switch — views key a "sweep" animation off it. */
  sweepKey: number;
  bumpSweep: () => void;

  /** Ask a request's URL field to take focus (after "New request"). */
  focusUrlOf: string | null;
  requestUrlFocus: (requestId: string | null) => void;
}

/** What changes while requests run. Kept only for requests open in a tab. */
interface SessionRuns {
  responses: Record<string, ResponseEntry | undefined>;
  sending: Record<string, boolean | undefined>;
  bursts: Record<string, BurstRun | undefined>;
  responseTab: (requestId: string) => ResponseTab;
}

export interface SessionValue extends SessionCore, SessionRuns {}

const SessionContext = createContext<SessionCore | null>(null);
const RunsContext = createContext<SessionRuns | null>(null);
const TABS_KEY = "satchel.tabs";
/** Burst results are batched into state at most this often (a run can report 200 times a second). */
const BURST_FLUSH_MS = 100;

function loadTabs(): { tabs: TabId[]; active: TabId | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null");
    if (raw && Array.isArray(raw.tabs)) return { tabs: raw.tabs, active: raw.active ?? null };
  } catch {
    // ignore
  }
  return { tabs: [], active: null };
}

export function unresolvedVariables(request: SatchelRequest, isKnown: (key: string) => boolean): string[] {
  const parts: string[] = [request.url, ...Object.values(request.pathVariables ?? {})];
  request.headers.filter((h) => h.enabled).forEach((h) => parts.push(h.value));
  const a = request.auth;
  if (a.type === "bearer") parts.push(a.token);
  if (a.type === "basic") parts.push(a.username, a.password);
  if (a.type === "apikey") parts.push(a.value);
  const b = request.body;
  if (b.mode === "raw") parts.push(b.raw);
  if (b.mode === "urlencoded") b.params.filter((p) => p.enabled).forEach((p) => parts.push(p.value));
  if (b.mode === "formdata") b.fields.filter((f) => f.enabled && f.type === "text").forEach((f) => parts.push(f.value));
  const keys = new Set<string>();
  for (const part of parts) for (const m of part.matchAll(VARIABLE_PATTERN)) keys.add(m[1]);
  return [...keys].filter((k) => !isKnown(k));
}

/** A copy of `map` without `ids` (the same object when none of them is in it). */
function without<T>(map: Record<string, T>, ids: Set<string>): Record<string, T> {
  if (!Object.keys(map).some((k) => ids.has(k))) return map;
  const next = { ...map };
  for (const id of ids) delete next[id];
  return next;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const initial = useRef(loadTabs());
  const [tabs, setTabs] = useState<TabId[]>(initial.current.tabs);
  const [activeTab, setActiveTabState] = useState<TabId | null>(initial.current.active);
  const [requestTabs, setRequestTabs] = useState<Record<string, RequestTab>>({});
  const [responseTabs, setResponseTabs] = useState<Record<string, ResponseTab>>({});
  const [responses, setResponses] = useState<Record<string, ResponseEntry | undefined>>({});
  const [sending, setSending] = useState<Record<string, boolean | undefined>>({});
  const [blocker, setBlocker] = useState<SendBlocker | null>(null);
  const [bursts, setBursts] = useState<Record<string, BurstRun | undefined>>({});
  const [burstConfig, setBurstConfig] = useState<BurstConfig>({ rps: 20, seconds: 5, stopAtFirst429: false });
  const [matrixFocus, setMatrixFocus] = useState<MatrixFocus | null>(null);
  const [sweepKey, setSweepKey] = useState(0);
  const [focusUrlOf, setFocusUrlOf] = useState<string | null>(null);
  const aborts = useRef<Record<string, AbortController>>({});
  const burstStops = useRef<Record<string, () => void>>({});
  /** The live run per request: results from a replaced run are dropped. */
  const burstTokens = useRef<Record<string, object>>({});
  /** Burst results not yet in state, flushed together (see BURST_FLUSH_MS). */
  const burstBuffer = useRef<Record<string, BurstResult[]>>({});
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The callbacks read the workspace through this ref, so they (and the context value)
  // stay the same while the user types.
  const wsRef = useRef(ws);
  useLayoutEffect(() => {
    wsRef.current = ws;
  });

  // Drop tabs whose request no longer exists (deleted, or a different file was opened).
  const collections = ws.workspace.collections;
  useEffect(() => {
    const { findRequest } = wsRef.current;
    setTabs((t) => {
      const next = t.filter((id) => id === ENVIRONMENTS_TAB || findRequest(id));
      return next.length === t.length ? t : next;
    });
  }, [collections]);
  useEffect(() => {
    if (activeTab && !tabs.includes(activeTab)) setActiveTabState(tabs[tabs.length - 1] ?? null);
  }, [tabs, activeTab]);
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: activeTab }));
    } catch {
      // ignore
    }
  }, [tabs, activeTab]);

  const flushBursts = useCallback(() => {
    if (burstTimer.current !== null) clearTimeout(burstTimer.current);
    burstTimer.current = null;
    const pending = burstBuffer.current;
    burstBuffer.current = {};
    const ids = Object.keys(pending);
    if (!ids.length) return;
    setBursts((b) => {
      let next = b;
      for (const id of ids) {
        const run = b[id];
        if (!run) continue;
        if (next === b) next = { ...b };
        next[id] = { ...run, results: mergeBySeq(run.results, pending[id]) };
      }
      return next;
    });
  }, []);

  /**
   * Let go of everything kept for these requests: an in-flight send is aborted,
   * a burst stopped, and the response (which can be many MB), burst results and
   * sub-tab choices dropped. Runs for every tab that closes.
   */
  const forget = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    for (const id of gone) {
      aborts.current[id]?.abort();
      delete aborts.current[id];
      burstStops.current[id]?.();
      delete burstStops.current[id];
      delete burstTokens.current[id];
      delete burstBuffer.current[id];
    }
    setResponses((m) => without(m, gone));
    setSending((m) => without(m, gone));
    setBursts((m) => without(m, gone));
    setRequestTabs((m) => without(m, gone));
    setResponseTabs((m) => without(m, gone));
    setBlocker((b) => (b && gone.has(b.requestId) ? null : b));
    setFocusUrlOf((f) => (f && gone.has(f) ? null : f));
  }, []);

  // Whatever way tabs go away (close, close others/to the right/all, deleted
  // requests, another workspace opened), forget what they held.
  const shownTabs = useRef(tabs);
  useEffect(() => {
    const previous = shownTabs.current;
    shownTabs.current = tabs;
    if (previous !== tabs) forget(previous.filter((id) => !tabs.includes(id)));
  }, [tabs, forget]);

  // Stop timers and in-flight work on unmount.
  useEffect(
    () => () => {
      if (burstTimer.current !== null) clearTimeout(burstTimer.current);
      Object.values(aborts.current).forEach((c) => c.abort());
      Object.values(burstStops.current).forEach((stop) => stop());
    },
    [],
  );

  const openTab = useCallback((id: TabId) => {
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActiveTabState(id);
    setBlocker(null);
  }, []);

  const closeTab = useCallback((id: TabId) => {
    setTabs((t) => {
      const i = t.indexOf(id);
      if (i < 0) return t;
      const next = t.filter((x) => x !== id);
      setActiveTabState((active) => (active === id ? (next[Math.min(i, next.length - 1)] ?? null) : active));
      return next;
    });
  }, []);

  const closeOtherTabs = useCallback((id: TabId) => {
    setTabs((t) => (t.includes(id) ? (t.length === 1 ? t : [id]) : t));
    setActiveTabState(id);
  }, []);

  const closeTabsToRight = useCallback((id: TabId) => {
    setTabs((t) => {
      const i = t.indexOf(id);
      if (i < 0 || i === t.length - 1) return t;
      const next = t.slice(0, i + 1);
      setActiveTabState((active) => (active && !next.includes(active) ? id : active));
      return next;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabState(null);
  }, []);

  const setActiveTab = useCallback((id: TabId) => {
    setActiveTabState(id);
    setBlocker(null);
  }, []);

  const send = useCallback((requestId: string, opts?: { force?: boolean }) => {
    const ws = wsRef.current;
    const loc = ws.findRequest(requestId);
    if (!loc) return;
    const ctx = ws.variableContext(requestId);
    const missing = unresolvedVariables(loc.request, (k) => isResolved(k, ctx));
    if (missing.length && !opts?.force) {
      setBlocker({ requestId, missingVariables: missing });
      return;
    }
    const emptyPath = pathParamNames(loc.request.url).filter((n) => !loc.request.pathVariables?.[n]);
    if (emptyPath.length && !opts?.force) {
      setRequestTabs((m) => ({ ...m, [requestId]: "params" }));
      setResponses((r) => ({ ...r, [requestId]: { kind: "error", message: `Path parameter :${emptyPath[0]} needs a value.` } }));
      return;
    }
    setBlocker(null);
    aborts.current[requestId]?.abort();
    const controller = new AbortController();
    aborts.current[requestId] = controller;
    setSending((s) => ({ ...s, [requestId]: true }));
    setResponseTabs((m) => (m[requestId] === "burst" ? { ...m, [requestId]: "body" } : m));
    sendRequest(loc.request, mergedVariables(ctx), controller.signal)
      .then((response) => {
        // Cancelled, replaced by a newer send, or its tab closed while the body was read.
        if (controller.signal.aborted) return;
        setResponses((r) => ({ ...r, [requestId]: { kind: "ok", response } }));
        publishResponse(snapshotOf(loc.request, response));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const message = errorMessage(err, "Request failed");
        setResponses((r) => ({ ...r, [requestId]: { kind: "error", message } }));
      })
      .finally(() => {
        if (aborts.current[requestId] === controller) {
          delete aborts.current[requestId];
          setSending((s) => ({ ...s, [requestId]: false }));
        }
      });
  }, []);

  const cancel = useCallback((requestId: string) => {
    aborts.current[requestId]?.abort();
    delete aborts.current[requestId];
    setSending((s) => ({ ...s, [requestId]: false }));
  }, []);

  const startBurstRun = useCallback(
    (requestId: string) => {
      const ws = wsRef.current;
      const loc = ws.findRequest(requestId);
      if (!loc) return;
      burstStops.current[requestId]?.();
      const token = {};
      burstTokens.current[requestId] = token;
      delete burstBuffer.current[requestId];
      const config = burstConfig;
      const total = Math.min(Math.max(config.rps, 1), 200) * Math.min(Math.max(config.seconds, 1), 60);
      setBursts((b) => ({ ...b, [requestId]: { config, total, running: true, results: [], startedAt: Date.now() } }));
      setResponseTabs((m) => ({ ...m, [requestId]: "burst" }));
      burstStops.current[requestId] = startBurst(
        loc.request,
        mergedVariables(ws.variableContext(requestId)),
        config,
        (result) => {
          if (burstTokens.current[requestId] !== token) return;
          (burstBuffer.current[requestId] ??= []).push(result);
          if (burstTimer.current === null) burstTimer.current = setTimeout(flushBursts, BURST_FLUSH_MS);
        },
        () => {
          if (burstTokens.current[requestId] !== token) return;
          // Everything reported so far goes in with the "done", so the final numbers are exact.
          flushBursts();
          setBursts((b) => (b[requestId] ? { ...b, [requestId]: { ...b[requestId]!, running: false } } : b));
        },
      );
    },
    [burstConfig, flushBursts],
  );

  const stopBurstRun = useCallback((requestId: string) => {
    burstStops.current[requestId]?.();
    delete burstStops.current[requestId];
  }, []);

  const requestTab = useCallback(
    (requestId: string, request?: SatchelRequest) =>
      requestTabs[requestId] ?? (request && request.body.mode !== "none" ? "body" : "params"),
    [requestTabs],
  );
  const setRequestTab = useCallback((requestId: string, tab: RequestTab) => setRequestTabs((m) => ({ ...m, [requestId]: tab })), []);
  const setResponseTab = useCallback((requestId: string, tab: ResponseTab) => setResponseTabs((m) => ({ ...m, [requestId]: tab })), []);
  const clearBlocker = useCallback(() => setBlocker(null), []);
  const openEnvironments = useCallback(
    (focus?: MatrixFocus) => {
      setMatrixFocus(focus ?? null);
      openTab(ENVIRONMENTS_TAB);
    },
    [openTab],
  );
  const clearMatrixFocus = useCallback(() => setMatrixFocus(null), []);
  const bumpSweep = useCallback(() => setSweepKey((k) => k + 1), []);

  const core = useMemo<SessionCore>(
    () => ({
      tabs,
      activeTab,
      openTab,
      closeTab,
      closeOtherTabs,
      closeTabsToRight,
      closeAllTabs,
      setActiveTab,
      requestTab,
      setRequestTab,
      setResponseTab,
      send,
      cancel,
      blocker,
      clearBlocker,
      burstConfig,
      setBurstConfig,
      startBurstRun,
      stopBurstRun,
      matrixFocus,
      openEnvironments,
      clearMatrixFocus,
      sweepKey,
      bumpSweep,
      focusUrlOf,
      requestUrlFocus: setFocusUrlOf,
    }),
    [
      tabs,
      activeTab,
      openTab,
      closeTab,
      closeOtherTabs,
      closeTabsToRight,
      closeAllTabs,
      setActiveTab,
      requestTab,
      setRequestTab,
      setResponseTab,
      send,
      cancel,
      blocker,
      clearBlocker,
      burstConfig,
      startBurstRun,
      stopBurstRun,
      matrixFocus,
      openEnvironments,
      clearMatrixFocus,
      sweepKey,
      bumpSweep,
      focusUrlOf,
    ],
  );

  const runs = useMemo<SessionRuns>(
    () => ({
      responses,
      sending,
      bursts,
      responseTab: (requestId) => {
        const t = responseTabs[requestId] ?? "body";
        return t === "burst" && !bursts[requestId] ? "body" : t;
      },
    }),
    [responses, sending, bursts, responseTabs],
  );

  return (
    <SessionContext.Provider value={core}>
      <RunsContext.Provider value={runs}>{children}</RunsContext.Provider>
    </SessionContext.Provider>
  );
}

/** Tabs, view state and actions; doesn't re-render when responses or burst results arrive. */
export function useSessionCore(): SessionCore {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionCore must be used inside <SessionProvider>");
  return ctx;
}

/** Responses, in-flight sends and burst runs (changes often while requests run). */
export function useSessionRuns(): SessionRuns {
  const ctx = useContext(RunsContext);
  if (!ctx) throw new Error("useSessionRuns must be used inside <SessionProvider>");
  return ctx;
}

/** Everything: prefer useSessionCore where responses and bursts aren't needed. */
export function useSession(): SessionValue {
  const core = useSessionCore();
  const runs = useSessionRuns();
  return useMemo(() => ({ ...core, ...runs }), [core, runs]);
}
