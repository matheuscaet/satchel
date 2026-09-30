import type { ParsedCurl } from "@/curl";
import type { RequestTab } from "@/state/session";
import type { RequestBody, SatchelRequest } from "@/types";
import { normalizeRequest } from "@/url";

function bodyLabel(body: RequestBody): string | null {
  if (body.mode === "raw") return body.language === "json" ? "JSON body" : body.language === "text" ? "text body" : `${body.language.toUpperCase()} body`;
  if (body.mode === "urlencoded") return "URL-encoded body";
  if (body.mode === "formdata") return "form-data body";
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "POST, 3 headers, Bearer auth, JSON body. Cookies kept in the Cookie header." */
export function describeParsedCurl(parsed: ParsedCurl): string {
  const parts: string[] = [parsed.method, plural(parsed.headers.length, "header")];
  const query = parsed.params.length;
  if (query) parts.push(plural(query, "query param"));
  if (parsed.auth.type === "bearer") parts.push("Bearer auth");
  if (parsed.auth.type === "basic") parts.push("Basic auth");
  const body = bodyLabel(parsed.body);
  if (body) parts.push(body);
  let text = `${parts.join(", ")}.`;
  if (parsed.headers.some((h) => h.key.toLowerCase() === "cookie")) text += " Cookies kept in the Cookie header.";
  return text;
}

/** The request pane tab that shows the most of what was pasted. */
export function tabForParsedCurl(parsed: ParsedCurl): RequestTab {
  if (parsed.body.mode !== "none") return "body";
  if (parsed.params.length > 0) return "params";
  if (parsed.headers.length > 0) return "headers";
  if (parsed.auth.type !== "none") return "auth";
  return "params";
}

/** A request name from a URL's path: "https://api.x.com/v1/users?page=2" → "/v1/users". */
export function requestNameFromUrl(url: string): string {
  const path = url.replace(/^(?:[a-z][\w+.-]*:\/\/)?[^/?#]*/i, "").split(/[?#]/)[0] || "/";
  return path.length > 40 ? `…${path.slice(-39)}` : path;
}

export const DEFAULT_REQUEST_NAME = "New request";

/**
 * The request with everything the curl command describes: method, URL, params, headers,
 * auth and body. The name is kept unless it's still the default.
 */
export function applyParsedCurl(request: SatchelRequest, parsed: ParsedCurl): SatchelRequest {
  return normalizeRequest({
    ...request,
    name: request.name === DEFAULT_REQUEST_NAME ? requestNameFromUrl(parsed.url) : request.name,
    method: parsed.method,
    url: parsed.url,
    params: parsed.params,
    pathVariables: {},
    headers: parsed.headers,
    auth: parsed.auth,
    body: parsed.body,
  });
}
