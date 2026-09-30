import type { KeyValue, SatchelRequest } from "./types";
import { resolveVariables } from "./collectionTree";
import { applyPathParams, normalizeRequest } from "./url";
import { base64Utf8 } from "./lib/base64";

// Shared by single sends and the Rate Limit burst runner so both build the
// exact same request off a SatchelRequest + variable set.

export function buildHeaders(request: SatchelRequest, variables: KeyValue[]): Headers {
  const headers = new Headers();
  for (const h of request.headers) {
    if (h.enabled && h.key) headers.set(h.key, resolveVariables(h.value, variables));
  }
  const auth = request.auth;
  if (auth.type === "bearer" && auth.token) headers.set("Authorization", `Bearer ${resolveVariables(auth.token, variables)}`);
  if (auth.type === "basic" && auth.username) {
    const user = resolveVariables(auth.username, variables);
    const pass = resolveVariables(auth.password, variables);
    headers.set("Authorization", `Basic ${base64Utf8(`${user}:${pass}`)}`);
  }
  if (auth.type === "apikey" && auth.in === "header" && auth.key) headers.set(auth.key, resolveVariables(auth.value, variables));
  const body = request.body;
  if (!hasContentType(request)) {
    if (body.mode === "raw" && body.language === "json") headers.set("Content-Type", "application/json");
    if (body.mode === "urlencoded") headers.set("Content-Type", "application/x-www-form-urlencoded");
    // multipart: fetch sets Content-Type (with the boundary) itself from the FormData body.
  }
  return headers;
}

function hasContentType(request: SatchelRequest): boolean {
  return request.headers.some((h) => h.enabled && h.key.toLowerCase() === "content-type");
}

/** The fully resolved URL: variables substituted, :path params filled, query from the URL itself. */
export function buildUrl(request: SatchelRequest, variables: KeyValue[]): string {
  const normalized = normalizeRequest(request);
  const pathValues = Object.fromEntries(
    Object.entries(normalized.pathVariables ?? {}).map(([k, v]) => [k, resolveVariables(v, variables)]),
  );
  const resolved = resolveVariables(applyPathParams(normalized.url, pathValues), variables);
  const url = new URL(/^https?:\/\//i.test(resolved) ? resolved : `https://${resolved}`);
  if (request.auth.type === "apikey" && request.auth.in === "query" && request.auth.key) {
    url.searchParams.set(request.auth.key, resolveVariables(request.auth.value, variables));
  }
  return url.toString();
}

/** Text bodies only (raw / urlencoded). multipart/form-data is built by http/send.ts because it needs file IO. */
export function buildBody(request: SatchelRequest, variables: KeyValue[]): string | undefined {
  if (request.body.mode === "raw") return resolveVariables(request.body.raw, variables);
  if (request.body.mode === "urlencoded") {
    return new URLSearchParams(
      request.body.params.filter((p) => p.enabled).map((p) => [p.key, resolveVariables(p.value, variables)]),
    ).toString();
  }
  return undefined;
}

/** Methods that carry a request body. QUERY is safe like GET but carries its query in the body. */
export function methodSendsBody(method: SatchelRequest["method"]): boolean {
  return method !== "GET" && method !== "HEAD";
}
