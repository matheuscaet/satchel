import type { KeyValue, SatchelRequest } from "./types";
import { resolveVariables } from "./collectionTree";
import { buildUrl, methodSendsBody } from "./requestBuilder";
import { applyPathParams, normalizeRequest } from "./url";
import { VARIABLE_PATTERN } from "./variableTokens";

// A request as a bash curl command that sends what Satchel sends: the same URL
// (variables, :path params and an API key in the query applied), the same
// headers (auth-derived ones and the Content-Type Satchel adds on its own),
// and the same body. With `variables === null`, {{variables}} and :params are
// kept exactly as written instead.

export interface CurlExportOptions {
  /** One option per line with `\` continuations (default), or everything on one line */
  multiline?: boolean;
}

/** POSIX single-quoting: everything literal, a ' becomes '\''. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolvedUrl(request: SatchelRequest, variables: KeyValue[]): string {
  const normalized = normalizeRequest(request);
  const pathValues = Object.fromEntries(Object.entries(normalized.pathVariables ?? {}).map(([k, v]) => [k, resolveVariables(v, variables)]));
  const resolved = resolveVariables(applyPathParams(normalized.url, pathValues), variables);
  if (!resolved.match(VARIABLE_PATTERN)) {
    try {
      return buildUrl(request, variables); // exactly what's sent
    } catch {
      // not a valid URL: fall through and build the string by hand
    }
  }
  // An undefined {{variable}} stays exactly as written (the URL parser would lowercase or encode it).
  const url = /^[a-z][\w+.-]*:\/\//i.test(resolved) || resolved.startsWith("{{") ? resolved : `https://${resolved}`;
  return withApiKeyQuery(url, request, (s) => resolveVariables(s, variables));
}

function withApiKeyQuery(url: string, request: SatchelRequest, value: (s: string) => string): string {
  const auth = request.auth;
  if (auth.type !== "apikey" || auth.in !== "query" || !auth.key) return url;
  const sep = !url.includes("?") ? "?" : /[?&]$/.test(url) ? "" : "&";
  return `${url}${sep}${auth.key}=${value(auth.value)}`;
}

/**
 * The headers requestBuilder.buildHeaders sends, in order and with their names as
 * typed (Headers lowercases them). Basic auth comes back separately, for -u.
 */
export function exportHeaders(
  request: SatchelRequest,
  value: (s: string) => string,
): { headers: [string, string][]; basic: { username: string; password: string } | null } {
  const headers: [string, string][] = [];
  const set = (name: string, v: string) => {
    const i = headers.findIndex(([n]) => n.toLowerCase() === name.toLowerCase());
    if (i >= 0) headers[i] = [headers[i][0], v];
    else headers.push([name, v]);
  };
  const remove = (name: string) => {
    const i = headers.findIndex(([n]) => n.toLowerCase() === name.toLowerCase());
    if (i >= 0) headers.splice(i, 1);
  };
  for (const h of request.headers) if (h.enabled && h.key) set(h.key, value(h.value));

  let basic: { username: string; password: string } | null = null;
  const auth = request.auth;
  if (auth.type === "bearer" && auth.token) set("Authorization", `Bearer ${value(auth.token)}`);
  if (auth.type === "basic" && auth.username) {
    const username = value(auth.username);
    const password = value(auth.password);
    if (username.includes(":")) set("Authorization", `Basic ${base64Utf8(`${username}:${password}`)}`); // -u can't carry it
    else {
      remove("Authorization"); // Satchel's Basic header replaces a typed one; with -u, a -H would win instead
      basic = { username, password };
    }
  }
  if (auth.type === "apikey" && auth.in === "header" && auth.key) set(auth.key, value(auth.value));

  const hasContentType = request.headers.some((h) => h.enabled && h.key.toLowerCase() === "content-type");
  if (!hasContentType) {
    if (request.body.mode === "raw" && request.body.language === "json") set("Content-Type", "application/json");
    if (request.body.mode === "urlencoded") set("Content-Type", "application/x-www-form-urlencoded");
  }
  return { headers, basic };
}

function base64Utf8(text: string): string {
  let binary = "";
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Names --data-urlencode can take as-is (no =, @, & or characters that need encoding). */
const PLAIN_NAME = /^[\w.~-]+$/;

function formFileArg(key: string, path: string, fileName: string | undefined): string {
  const needsQuotes = /[;,"\\\s]/.test(path);
  let arg = `${key}=@${needsQuotes ? `"${path.replace(/[\\"]/g, "\\$&")}"` : path}`;
  if (fileName && fileName !== path.split(/[/\\]/).pop()) arg += `;filename=${/[;,"\s]/.test(fileName) ? `"${fileName.replace(/[\\"]/g, "\\$&")}"` : fileName}`;
  return arg;
}

export function requestToCurl(request: SatchelRequest, variables: KeyValue[] | null, opts: CurlExportOptions = {}): string {
  const resolve = variables !== null;
  const value = (s: string) => (resolve ? resolveVariables(s, variables) : s);
  const url = resolve ? resolvedUrl(request, variables) : withApiKeyQuery(request.url, request, value);

  const args: string[] = [];
  if (request.method === "HEAD") args.push("--head");
  else if (request.method !== "GET") args.push(`-X ${request.method}`);

  const { headers, basic } = exportHeaders(request, value);
  if (basic) args.push(`-u ${shellQuote(`${basic.username}:${basic.password}`)}`);
  for (const [name, v] of headers) args.push(`-H ${shellQuote(v === "" ? `${name};` : `${name}: ${v}`)}`);

  const body = request.body;
  if (methodSendsBody(request.method)) {
    if (body.mode === "raw" && body.raw !== "") {
      args.push(`--data-raw ${shellQuote(value(body.raw))}`);
    } else if (body.mode === "urlencoded") {
      for (const p of body.params) {
        if (!p.enabled) continue;
        const v = value(p.value);
        if (PLAIN_NAME.test(p.key)) args.push(`--data-urlencode ${shellQuote(`${p.key}=${v}`)}`);
        else args.push(`--data-raw ${shellQuote(`${encodeURIComponent(p.key)}=${encodeURIComponent(v)}`)}`);
      }
    } else if (body.mode === "formdata") {
      for (const f of body.fields) {
        if (!f.enabled || !f.key) continue;
        if (f.type === "file") {
          const path = f.filePath ?? f.fileName ?? "";
          args.push(`-F ${shellQuote(formFileArg(f.key, path, f.fileName))}`);
        } else {
          const v = value(f.value);
          // -F reads @file, <file and ;type= out of the value; --form-string sends it literally.
          const literal = /^[@<]/.test(v) || /[;"]/.test(v);
          args.push(`${literal ? "--form-string" : "-F"} ${shellQuote(`${f.key}=${v}`)}`);
        }
      }
    }
  }

  const first = `curl ${shellQuote(url)}`;
  return (opts.multiline ?? true) ? [first, ...args].join(" \\\n  ") : [first, ...args].join(" ");
}
