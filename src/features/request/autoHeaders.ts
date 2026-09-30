import type { KeyValue, SatchelRequest } from "@/types";
import { resolveVariables } from "@/collectionTree";
import { methodSendsBody } from "@/requestBuilder";
import { base64Utf8 } from "@/lib/base64";

export interface AutoRow {
  key: string;
  /** Display value; may contain {{variables}}, which get highlighted */
  value: string;
}

/**
 * Headers Satchel adds on its own at send time (mirrors requestBuilder.buildHeaders),
 * shown read-only under the user's headers so nothing is sent that isn't visible.
 */
export function autoHeaders(request: SatchelRequest, variables: KeyValue[]): AutoRow[] {
  const rows: AutoRow[] = [];
  const has = (name: string) => request.headers.some((h) => h.enabled && h.key.toLowerCase() === name);
  const auth = request.auth;
  if (auth.type === "bearer" && auth.token) rows.push({ key: "Authorization", value: `Bearer ${auth.token}` });
  if (auth.type === "basic" && auth.username) {
    const user = resolveVariables(auth.username, variables);
    const pass = resolveVariables(auth.password, variables);
    rows.push({ key: "Authorization", value: `Basic ${base64Utf8(`${user}:${pass}`)}` });
  }
  if (auth.type === "apikey" && auth.in === "header" && auth.key) rows.push({ key: auth.key, value: auth.value });

  const body = request.body;
  if (!has("content-type")) {
    if (body.mode === "raw" && body.language === "json") rows.push({ key: "Content-Type", value: "application/json" });
    if (body.mode === "formdata") rows.push({ key: "Content-Type", value: "multipart/form-data; boundary=…" });
    if (body.mode === "urlencoded") rows.push({ key: "Content-Type", value: "application/x-www-form-urlencoded" });
  }
  if (methodSendsBody(request.method)) {
    if (body.mode === "raw" && body.language === "json") {
      const resolved = resolveVariables(body.raw, variables);
      rows.push({ key: "Content-Length", value: String(new TextEncoder().encode(resolved).length) });
    }
    if (body.mode === "formdata") rows.push({ key: "Content-Length", value: "computed when sent" });
  }
  return rows;
}

/** An API key sent as a query param shows as an auto row in the Params table. */
export function autoQueryParams(request: SatchelRequest): AutoRow[] {
  const auth = request.auth;
  return auth.type === "apikey" && auth.in === "query" && auth.key ? [{ key: auth.key, value: auth.value }] : [];
}
