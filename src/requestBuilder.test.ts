import { describe, expect, it } from "vitest";
import { buildBody, buildHeaders, buildUrl } from "./requestBuilder";
import type { KeyValue, SatchelRequest } from "./types";

// Regression coverage for a real bug: buildHeaders/buildUrl resolved
// {{variables}} in the URL and raw body, but sent header values, Bearer
// tokens, Basic credentials, API keys, and urlencoded body params
// completely literal — "Bearer {{token}}" went out over the wire as-is.

const vars: KeyValue[] = [
  { key: "token", value: "secret-abc", enabled: true },
  { key: "user", value: "alice", enabled: true },
  { key: "pass", value: "hunter2", enabled: true },
  { key: "host", value: "api.example.com", enabled: true },
];

function baseRequest(overrides: Partial<SatchelRequest>): SatchelRequest {
  return {
    id: "r1",
    name: "Test",
    method: "GET",
    url: "https://{{host}}/items",
    params: [],
    headers: [],
    auth: { type: "none" },
    body: { mode: "none" },
    ...overrides,
  };
}

describe("buildUrl", () => {
  it("resolves variables in the host/path and in param values", () => {
    const req = baseRequest({ params: [{ key: "q", value: "{{token}}", enabled: true }] });
    expect(buildUrl(req, vars)).toBe("https://api.example.com/items?q=secret-abc");
  });

  it("resolves variables in a query-param API key", () => {
    const req = baseRequest({ auth: { type: "apikey", key: "api_key", value: "{{token}}", in: "query" } });
    expect(buildUrl(req, vars)).toBe("https://api.example.com/items?api_key=secret-abc");
  });
});

describe("buildHeaders", () => {
  it("resolves variables in a regular header value", () => {
    const req = baseRequest({ headers: [{ key: "X-Trace", value: "{{token}}", enabled: true }] });
    expect(buildHeaders(req, vars).get("X-Trace")).toBe("secret-abc");
  });

  it("resolves a {{token}} Bearer auth value", () => {
    const req = baseRequest({ auth: { type: "bearer", token: "{{token}}" } });
    expect(buildHeaders(req, vars).get("Authorization")).toBe("Bearer secret-abc");
  });

  it("resolves {{variables}} in Basic auth username/password", () => {
    const req = baseRequest({ auth: { type: "basic", username: "{{user}}", password: "{{pass}}" } });
    expect(buildHeaders(req, vars).get("Authorization")).toBe(`Basic ${btoa("alice:hunter2")}`);
  });

  it("resolves a header-mode API key value", () => {
    const req = baseRequest({ auth: { type: "apikey", key: "X-Api-Key", value: "{{token}}", in: "header" } });
    expect(buildHeaders(req, vars).get("X-Api-Key")).toBe("secret-abc");
  });
});

describe("buildBody", () => {
  it("resolves variables in a raw body", () => {
    const req = baseRequest({ body: { mode: "raw", raw: '{"auth":"{{token}}"}', language: "json" } });
    expect(buildBody(req, vars)).toBe('{"auth":"secret-abc"}');
  });

  it("resolves variables in urlencoded body param values", () => {
    const req = baseRequest({
      body: { mode: "urlencoded", params: [{ key: "user", value: "{{user}}", enabled: true }] },
    });
    expect(buildBody(req, vars)).toBe("user=alice");
  });
});

describe("basic auth encoding", () => {
  it("encodes non-Latin-1 credentials as UTF-8 instead of throwing", () => {
    const req = baseRequest({ auth: { type: "basic", username: "josé", password: "señha✓" } });
    const header = buildHeaders(req, vars).get("Authorization")!;
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
    expect(decoded).toBe("josé:señha✓");
  });
});
