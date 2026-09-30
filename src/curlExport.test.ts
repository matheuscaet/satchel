import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { requestToCurl, shellQuote } from "./curlExport";
import { parseCurl } from "./curl";
import { buildBody, buildHeaders, buildUrl, methodSendsBody } from "./requestBuilder";
import { normalizeRequest } from "./url";
import type { FormField, KeyValue, SatchelRequest } from "./types";

function req(overrides: Partial<SatchelRequest>): SatchelRequest {
  return normalizeRequest({
    id: "r1",
    name: "Test",
    method: "GET",
    url: "https://api.example.com/items",
    params: [],
    headers: [],
    auth: { type: "none" },
    body: { mode: "none" },
    ...overrides,
  });
}

const kv = (key: string, value: string, enabled = true): KeyValue => ({ key, value, enabled });

const vars: KeyValue[] = [
  kv("baseUrl", "https://api.example.com"),
  kv("token", "secret-abc"),
  kv("user", "alice"),
  kv("pass", "hunter2"),
  kv("userId", "42"),
];

/** What Satchel puts on the wire for a request: compare two requests by this. */
function sent(r: SatchelRequest, variables: KeyValue[] = []) {
  const headers = [...buildHeaders(r, variables).entries()].sort(([a], [b]) => a.localeCompare(b));
  let body: unknown = undefined;
  if (methodSendsBody(r.method)) {
    if (r.body.mode === "raw") {
      const text = buildBody(r, variables) ?? "";
      body = r.body.language === "json" ? safeJson(text) : text;
    } else if (r.body.mode === "urlencoded") body = [...new URLSearchParams(buildBody(r, variables))];
    else if (r.body.mode === "formdata")
      body = r.body.fields
        .filter((f) => f.enabled && f.key)
        .map((f) => (f.type === "text" ? [f.key, f.value] : [f.key, "@", f.filePath, f.fileName]));
  }
  return { method: r.method, url: buildUrl(r, variables), headers, body };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The command parsed back into a request. */
function roundTrip(r: SatchelRequest, variables: KeyValue[] | null = []): SatchelRequest {
  const parsed = parseCurl(requestToCurl(r, variables));
  return req({ method: parsed.method, url: parsed.url, params: parsed.params, headers: parsed.headers, auth: parsed.auth, body: parsed.body });
}

/** Run the command through real bash with `curl` stubbed to print its arguments. */
function bashArgs(command: string): string[] | null {
  try {
    const out = execFileSync("bash", ["-c", `curl() { printf '%s\\0' "$@"; }\n${command}`], { encoding: "utf8" });
    return out.split("\0").slice(0, -1);
  } catch {
    return null;
  }
}

describe("shellQuote", () => {
  it("single-quotes everything and escapes ' as '\\''", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("$HOME `x` \\ \"q\"")).toBe(`'$HOME \`x\` \\ "q"'`);
  });
});

describe("requestToCurl", () => {
  it("GET: no -X, one option per line", () => {
    const r = req({ url: "{{baseUrl}}/users?page=2", headers: [kv("Accept", "application/json"), kv("X-Off", "1", false)] });
    expect(requestToCurl(r, vars)).toBe(`curl 'https://api.example.com/users?page=2' \\\n  -H 'Accept: application/json'`);
    expect(requestToCurl(r, vars, { multiline: false })).toBe(`curl 'https://api.example.com/users?page=2' -H 'Accept: application/json'`);
  });

  it("JSON POST: explicit -X, the Content-Type Satchel adds, and --data-raw", () => {
    const r = req({
      method: "POST",
      url: "{{baseUrl}}/users",
      auth: { type: "bearer", token: "{{token}}" },
      body: { mode: "raw", raw: '{"name":"{{user}}"}', language: "json" },
    });
    expect(requestToCurl(r, vars)).toBe(
      [
        "curl 'https://api.example.com/users'",
        "-X POST",
        "-H 'Authorization: Bearer secret-abc'",
        "-H 'Content-Type: application/json'",
        `--data-raw '{"name":"alice"}'`,
      ].join(" \\\n  "),
    );
  });

  it("keeps {{variables}} and :params as written when not resolving", () => {
    const r = req({
      method: "PUT",
      url: "{{baseUrl}}/users/:id?expand={{expand}}",
      pathVariables: { id: "{{userId}}" },
      headers: [kv("X-Trace", "{{trace}}")],
      auth: { type: "apikey", key: "api_key", value: "{{key}}", in: "query" },
      body: { mode: "raw", raw: '{"id": {{userId}}}', language: "json" },
    });
    const cmd = requestToCurl(r, null, { multiline: false });
    expect(cmd).toBe(
      `curl '{{baseUrl}}/users/:id?expand={{expand}}&api_key={{key}}' -X PUT -H 'X-Trace: {{trace}}' -H 'Content-Type: application/json' --data-raw '{"id": {{userId}}}'`,
    );
  });

  it("resolves :path params and leaves undefined {{variables}} readable", () => {
    const r = req({ url: "{{baseUrl}}/users/:id/{{missing}}", pathVariables: { id: "{{userId}}" } });
    expect(requestToCurl(r, vars)).toBe("curl 'https://api.example.com/users/42/{{missing}}'");
    // Left exactly as written: the URL parser would lowercase a {{Host}} or percent-encode a path one.
    expect(requestToCurl(req({ url: "{{apiHost}}/x" }), vars)).toBe("curl '{{apiHost}}/x'");
    expect(requestToCurl(req({ url: "https://{{apiHost}}/x?q={{Q}}" }), vars)).toBe("curl 'https://{{apiHost}}/x?q={{Q}}'");
    // Not a valid URL at all: still built by hand rather than failing.
    expect(requestToCurl(req({ url: "{{baseUrl}} /x y" }), vars)).toBe("curl 'https://api.example.com /x y'");
  });

  it("basic auth becomes -u; an API key goes in a header or the query", () => {
    const basic = req({ auth: { type: "basic", username: "{{user}}", password: "{{pass}}" }, headers: [kv("Authorization", "old")] });
    expect(requestToCurl(basic, vars, { multiline: false })).toBe("curl 'https://api.example.com/items' -u 'alice:hunter2'");
    const header = req({ auth: { type: "apikey", key: "X-Api-Key", value: "{{token}}", in: "header" } });
    expect(requestToCurl(header, vars, { multiline: false })).toBe("curl 'https://api.example.com/items' -H 'X-Api-Key: secret-abc'");
    const query = req({ auth: { type: "apikey", key: "key", value: "{{token}}", in: "query" } });
    expect(requestToCurl(query, vars, { multiline: false })).toBe("curl 'https://api.example.com/items?key=secret-abc'");
  });

  it("urlencoded: one --data-urlencode per enabled field (names that need encoding go pre-encoded)", () => {
    const r = req({
      method: "POST",
      body: { mode: "urlencoded", params: [kv("grant_type", "password"), kv("user name", "a&b"), kv("off", "x", false)] },
    });
    expect(requestToCurl(r, [], { multiline: false })).toBe(
      "curl 'https://api.example.com/items' -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'grant_type=password' --data-raw 'user%20name=a%26b'",
    );
  });

  it("form-data: -F for text, --form-string when the value would be misread, @path for files", () => {
    const fields: FormField[] = [
      { key: "title", value: "Report", enabled: true, type: "text" },
      { key: "handle", value: "@ada", enabled: true, type: "text" },
      { key: "doc", value: "", enabled: true, type: "file", filePath: "/home/ada/report.pdf", fileName: "report.pdf" },
      { key: "photo", value: "", enabled: true, type: "file", filePath: "/tmp/a;b.png", fileName: "me.png" },
      { key: "remote", value: "", enabled: true, type: "file", fileName: "elsewhere.txt" },
      { key: "", value: "skipped", enabled: true, type: "text" },
    ];
    const cmd = requestToCurl(req({ method: "POST", body: { mode: "formdata", fields } }), [], { multiline: false });
    expect(cmd).toBe(
      `curl 'https://api.example.com/items' -X POST -F 'title=Report' --form-string 'handle=@ada' -F 'doc=@/home/ada/report.pdf' -F 'photo=@"/tmp/a;b.png";filename=me.png' -F 'remote=@elsewhere.txt'`,
    );
  });

  it("HEAD is --head; GET and HEAD never carry a body (Satchel doesn't send one)", () => {
    expect(requestToCurl(req({ method: "HEAD" }), [])).toBe("curl 'https://api.example.com/items' \\\n  --head");
    const get = req({ method: "GET", body: { mode: "raw", raw: "ignored", language: "text" } });
    expect(requestToCurl(get, [])).toBe("curl 'https://api.example.com/items'");
  });

  it("QUERY is explicit and carries its body", () => {
    const r = req({ method: "QUERY", body: { mode: "raw", raw: '{"where":{"a":1}}', language: "json" } });
    expect(requestToCurl(r, [])).toContain("-X QUERY");
    expect(requestToCurl(r, [])).toContain(`--data-raw '{"where":{"a":1}}'`);
  });

  it("sends the same headers as requestBuilder.buildHeaders", () => {
    const cases: SatchelRequest[] = [
      req({ headers: [kv("Accept", "a"), kv("accept", "b")], auth: { type: "bearer", token: "{{token}}" } }),
      req({ headers: [kv("Authorization", "Token x")], auth: { type: "bearer", token: "t" } }),
      req({ headers: [kv("Content-Type", "text/plain")], method: "POST", body: { mode: "raw", raw: "{}", language: "json" } }),
      req({ auth: { type: "basic", username: "{{user}}", password: "{{pass}}" } }),
      req({ auth: { type: "apikey", key: "X-Key", value: "{{token}}", in: "header" } }),
      req({ method: "POST", body: { mode: "urlencoded", params: [kv("a", "1")] } }),
    ];
    for (const r of cases) {
      const parsed = parseCurl(requestToCurl(r, vars));
      const back = req({ headers: parsed.headers, auth: parsed.auth, body: parsed.body, method: parsed.method });
      expect(sent(back).headers).toEqual(sent(r, vars).headers);
    }
  });
});

describe("round trip: parseCurl(requestToCurl(r)) sends the same request", () => {
  const cases: [string, SatchelRequest][] = [
    ["GET with query", req({ url: "https://api.example.com/search?q=a%20b&tag=x&tag=y", headers: [kv("Accept", "application/json")] })],
    ["JSON POST", req({ method: "POST", headers: [kv("X-Req", "1")], body: { mode: "raw", raw: '{\n  "name": "Ada",\n  "n": [1, 2]\n}', language: "json" } })],
    [
      "urlencoded",
      req({ method: "POST", body: { mode: "urlencoded", params: [kv("user", "ada@example.com"), kv("pass", "p&ss=w rd+%"), kv("empty", ""), kv("sp ace", "v")] } }),
    ],
    [
      "form-data",
      req({
        method: "PATCH",
        body: {
          mode: "formdata",
          fields: [
            { key: "title", value: "Q3; final \"draft\"", enabled: true, type: "text" },
            { key: "at", value: "@not-a-file", enabled: true, type: "text" },
            { key: "doc", value: "", enabled: true, type: "file", filePath: "/home/ada/My Docs/q3 report.pdf", fileName: "q3 report.pdf" },
            { key: "renamed", value: "", enabled: true, type: "file", filePath: "/tmp/x.bin", fileName: "upload.bin" },
          ],
        },
      }),
    ],
    ["basic auth", req({ auth: { type: "basic", username: "ada", password: "pa:ss'word" } })],
    ["basic auth, UTF-8 and a colon in the user", req({ auth: { type: "basic", username: "jo:sé", password: "wörd" } })],
    ["bearer auth", req({ method: "DELETE", auth: { type: "bearer", token: "eyJ.abc.def" } })],
    ["API key header", req({ auth: { type: "apikey", key: "X-Api-Key", value: "k-123", in: "header" } })],
    ["API key query", req({ url: "https://api.example.com/items?page=1", auth: { type: "apikey", key: "api_key", value: "k 123", in: "query" } })],
    ["QUERY", req({ method: "QUERY", body: { mode: "raw", raw: '{"where": {"status": "open"}}', language: "json" } })],
    ["HEAD", req({ method: "HEAD" })],
    ["OPTIONS", req({ method: "OPTIONS", headers: [kv("Origin", "https://app.example.com")] })],
    [
      "quoting: ' $ \\ and newlines in a text body",
      req({
        method: "POST",
        headers: [kv("Content-Type", "text/plain"), kv("X-Quote", `it's "$HOME" \\n`)],
        body: { mode: "raw", raw: "it's $HOME and `whoami` and $(id)\nback\\slash\\n and 'quotes'\n\ttab!", language: "text" },
      }),
    ],
    ["XML", req({ method: "PUT", headers: [kv("Content-Type", "application/xml")], body: { mode: "raw", raw: "<a b='1'>&amp;</a>", language: "xml" } })],
  ];

  for (const [name, r] of cases) {
    it(name, () => {
      expect(sent(roundTrip(r))).toEqual(sent(r));
    });
  }

  it("with variables resolved", () => {
    const r = req({
      method: "POST",
      url: "{{baseUrl}}/users/:id",
      pathVariables: { id: "{{userId}}" },
      auth: { type: "bearer", token: "{{token}}" },
      body: { mode: "urlencoded", params: [kv("name", "{{user}}")] },
    });
    expect(sent(roundTrip(r, vars))).toEqual(sent(r, vars));
  });

  it("with variables kept as written", () => {
    const r = req({
      method: "POST",
      url: "{{baseUrl}}/users?x={{userId}}",
      headers: [kv("X-Trace", "{{token}}")],
      auth: { type: "basic", username: "{{user}}", password: "{{pass}}" },
      body: { mode: "urlencoded", params: [kv("name", "{{user}}")] },
    });
    const back = roundTrip(r, null);
    expect(back.url).toBe("{{baseUrl}}/users?x={{userId}}");
    expect(back.auth).toEqual({ type: "basic", username: "{{user}}", password: "{{pass}}" });
    expect(sent(back, vars)).toEqual(sent(r, vars));
  });

  it("the parsed body keeps the request's shape", () => {
    const [, form] = cases.find(([n]) => n === "form-data")!;
    const back = roundTrip(form);
    expect(back.body).toEqual(form.body);
    const [, urlenc] = cases.find(([n]) => n === "urlencoded")!;
    expect(roundTrip(urlenc).body).toEqual(urlenc.body);
  });
});

describe("the command is valid bash", () => {
  const hostile = req({
    method: "POST",
    headers: [kv("X-Quote", `it's "$HOME" \\ \`id\``)],
    body: { mode: "raw", raw: "it's $HOME and `whoami` and $(id)\nback\\slash\\n and 'quotes'\n\ttab! é 🎉", language: "text" },
  });
  const args = bashArgs("true");
  it.skipIf(args === null)("bash receives exactly the arguments the parser reads", () => {
    const command = requestToCurl(hostile, []);
    const fromBash = bashArgs(command)!;
    expect(fromBash).toEqual([
      "https://api.example.com/items",
      "-X",
      "POST",
      "-H",
      `X-Quote: it's "$HOME" \\ \`id\``,
      "--data-raw",
      "it's $HOME and `whoami` and $(id)\nback\\slash\\n and 'quotes'\n\ttab! é 🎉",
    ]);
    expect(parseCurl(command).body).toEqual(hostile.body);
  });
});
