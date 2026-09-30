import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { readFile } from "@tauri-apps/plugin-fs";
import type { KeyValue, SatchelRequest } from "@/types";
import { isTauri } from "@/platform";
import { resolveVariables } from "@/collectionTree";
import { buildBody, buildHeaders, buildUrl, methodSendsBody } from "@/requestBuilder";

export interface HttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
  timeMs: number;
  sizeBytes: number;
  headers: [string, string][];
  /** Body exactly as received. The viewer indents JSON itself (and caches it), so no second copy is kept here. */
  rawBodyText: string;
  isJson: boolean;
}

export class SendError extends Error {}

const STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict",
  415: "Unsupported Media Type", 422: "Unprocessable Entity", 429: "Too Many Requests", 500: "Internal Server Error",
  502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};

export function statusText(status: number, fallback = ""): string {
  return fallback || STATUS_TEXT[status] || "";
}

const doFetch = (): typeof fetch => (isTauri() ? (tauriFetch as typeof fetch) : window.fetch.bind(window));

/** Build the fetch() init for a request: headers, and the body (multipart reads files from disk). */
export async function buildInit(request: SatchelRequest, variables: KeyValue[], signal?: AbortSignal): Promise<RequestInit> {
  const headers = buildHeaders(request, variables);
  let body: BodyInit | undefined;
  if (methodSendsBody(request.method)) {
    if (request.body.mode === "formdata") {
      const form = new FormData();
      for (const f of request.body.fields) {
        if (!f.enabled || !f.key) continue;
        if (f.type === "text") form.append(f.key, resolveVariables(f.value, variables));
        else {
          if (!f.filePath) throw new SendError(`Form field “${f.key}” has no file on this machine. Choose one first.`);
          if (!isTauri()) throw new SendError("Sending files needs the desktop app — run with `npm run tauri dev`.");
          const bytes = await readFile(f.filePath);
          form.append(f.key, new Blob([bytes]), f.fileName ?? f.filePath.split(/[/\\]/).pop());
        }
      }
      body = form;
    } else {
      body = buildBody(request, variables);
    }
  }
  return { method: request.method, headers, body, signal };
}

export async function sendRequest(request: SatchelRequest, variables: KeyValue[], signal?: AbortSignal): Promise<HttpResponse> {
  const url = buildUrl(request, variables);
  const init = await buildInit(request, variables, signal);
  const started = performance.now();
  const res = await doFetch()(url, init);
  const bytes = await res.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("json");
  return {
    status: res.status,
    statusText: statusText(res.status, res.statusText),
    ok: res.ok,
    timeMs: Math.round(performance.now() - started),
    sizeBytes: bytes.byteLength,
    headers: Array.from(res.headers.entries()),
    rawBodyText: text,
    isJson,
  };
}

export { doFetch };
