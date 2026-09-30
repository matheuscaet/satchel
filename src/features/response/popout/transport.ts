import { toast } from "sonner";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@/platform";
import type { ResponseSnapshot } from "./snapshot";

/**
 * Main window ⇄ response windows.
 *
 * A response window boots as a fresh page (`/?popout=<id>`), announces itself
 * with "ready", and the main window answers with the snapshot it was opened
 * for. Later responses to the same request are sent as "update" to the
 * windows showing it; each window decides whether it follows them.
 *
 * Desktop: Tauri events between webview windows. Browser (vite dev):
 * window.open + postMessage.
 */

export const POPOUT_PARAM = "popout";

const EV_READY = "satchel://popout-ready";
// Per window: Tauri evaluates an event's payload in every webview listening to that name,
// whatever its target, so a shared name would ship a multi-MB body to every window.
const evSnapshot = (id: string) => `satchel://popout-snapshot/${id}`;
const evUpdate = (id: string) => `satchel://popout-update/${id}`;
const MSG_READY = "satchel-popout-ready";
const MSG_SNAPSHOT = "satchel-popout-snapshot";
const MSG_UPDATE = "satchel-popout-update";

export interface SnapshotMessage {
  id: string;
  snapshot: ResponseSnapshot;
}

// ---- main window side -------------------------------------------------------

/** Latest snapshot per open window id. */
const snapshots = new Map<string, ResponseSnapshot>();
/** Browser only: handles of windows we opened. */
const browserWindows = new Map<string, Window>();
let installed = false;

function installMainListeners() {
  if (installed) return;
  installed = true;
  if (isTauri()) {
    void listen<{ id: string }>(EV_READY, ({ payload }) => {
      const snapshot = snapshots.get(payload.id);
      if (snapshot) void emitTo(payload.id, evSnapshot(payload.id), { id: payload.id, snapshot } satisfies SnapshotMessage);
    });
  } else {
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || e.data?.type !== MSG_READY) return;
      const id: string = e.data.id;
      const snapshot = snapshots.get(id);
      if (snapshot && e.source) (e.source as Window).postMessage({ type: MSG_SNAPSHOT, id, snapshot }, location.origin);
    });
  }
}

let counter = 0;

/** Open the response in its own window (desktop: a Tauri window; browser: window.open). */
export async function openResponsePopout(snapshot: ResponseSnapshot): Promise<void> {
  installMainListeners();
  const id = `response-${Date.now().toString(36)}-${++counter}`;
  snapshots.set(id, snapshot);
  const url = `/?${POPOUT_PARAM}=${encodeURIComponent(id)}`;
  const title = `${snapshot.method} ${snapshot.name} · Response`;

  if (isTauri()) {
    const win = new WebviewWindow(id, { url, title, width: 960, height: 720, minWidth: 480, minHeight: 360 });
    void win.once("tauri://error", (e) => {
      snapshots.delete(id);
      toast.error(`Couldn't open the response window: ${String(e.payload)}`);
    });
    void win.once("tauri://destroyed", () => snapshots.delete(id));
    return;
  }

  const w = window.open(url, id, "popup,width=960,height=720");
  if (!w) {
    snapshots.delete(id);
    toast.error("The browser blocked the new window. Allow pop-ups for this page.");
    return;
  }
  browserWindows.set(id, w);
}

/** Push a new response to any open windows following that request. */
export function publishResponse(snapshot: ResponseSnapshot): void {
  const following: string[] = [];
  for (const [id, s] of snapshots) {
    if (s.requestId !== snapshot.requestId) continue;
    snapshots.set(id, snapshot);
    following.push(id);
  }
  if (!following.length) return;
  if (isTauri()) {
    for (const id of following) void emitTo(id, evUpdate(id), snapshot);
    return;
  }
  for (const id of following) {
    const w = browserWindows.get(id);
    if (!w) continue;
    if (w.closed) {
      browserWindows.delete(id);
      snapshots.delete(id);
    } else w.postMessage({ type: MSG_UPDATE, snapshot }, location.origin);
  }
}

// ---- response window side ---------------------------------------------------

export function popoutIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get(POPOUT_PARAM);
}

/**
 * Ask the main window for this window's snapshot and subscribe to later
 * responses for the same request. Returns an unsubscribe function.
 */
export function connectPopout(
  id: string,
  onSnapshot: (snapshot: ResponseSnapshot) => void,
  onUpdate: (snapshot: ResponseSnapshot) => void,
): () => void {
  if (isTauri()) {
    const unlisteners: Promise<() => void>[] = [
      listen<SnapshotMessage>(evSnapshot(id), ({ payload }) => {
        if (payload.id === id) onSnapshot(payload.snapshot);
      }),
      listen<ResponseSnapshot>(evUpdate(id), ({ payload }) => onUpdate(payload)),
    ];
    // Listen first, then announce — otherwise the answer could arrive before we're listening.
    void Promise.all(unlisteners).then(() => emit(EV_READY, { id }));
    return () => unlisteners.forEach((u) => void u.then((fn) => fn()));
  }

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== location.origin) return;
    if (e.data?.type === MSG_SNAPSHOT && e.data.id === id) onSnapshot(e.data.snapshot);
    if (e.data?.type === MSG_UPDATE) onUpdate(e.data.snapshot);
  };
  window.addEventListener("message", onMessage);
  const host: Window | null = window.opener ?? (window.parent !== window ? window.parent : null);
  host?.postMessage({ type: MSG_READY, id }, location.origin);
  return () => window.removeEventListener("message", onMessage);
}
