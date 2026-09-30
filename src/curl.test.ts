import { describe, expect, it } from "vitest";
import { parseCurl, CurlParseError, looksLikeCurl, prettyJson } from "./curl";

const h = (key: string, value: string) => ({ key, value, enabled: true });

describe("parseCurl — basics", () => {
  it("parses a multi-line POST with headers and a JSON body", () => {
    const cmd = `curl -X POST 'https://jsonplaceholder.typicode.com/posts' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer abc123' \\
  -d '{"title":"hello","body":"world","userId":1}'`;

    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://jsonplaceholder.typicode.com/posts");
    // The Bearer header becomes auth (and isn't kept as a header too).
    expect(parsed.headers).toEqual([h("Content-Type", "application/json")]);
    expect(parsed.auth).toEqual({ type: "bearer", token: "abc123" });
    expect(parsed.body).toEqual({
      mode: "raw",
      raw: '{\n  "title": "hello",\n  "body": "world",\n  "userId": 1\n}',
      language: "json",
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("infers GET and turns the query string into params (the URL keeps it)", () => {
    const parsed = parseCurl("curl 'https://api.example.com/v1/items?limit=10&sort=-created' -H 'X-Api-Key: abc-def-123'");
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://api.example.com/v1/items?limit=10&sort=-created");
    expect(parsed.params).toEqual([h("limit", "10"), h("sort", "-created")]);
    expect(parsed.headers).toEqual([h("X-Api-Key", "abc-def-123")]);
    expect(parsed.body).toEqual({ mode: "none" });
  });

  it("infers POST when a body is present but -X is omitted", () => {
    const parsed = parseCurl("curl https://api.example.com/items -d 'name=foo'");
    expect(parsed.method).toBe("POST");
    expect(parsed.body).toEqual({ mode: "urlencoded", params: [h("name", "foo")] });
  });

  it("parses basic auth from -u (the password may contain colons)", () => {
    expect(parseCurl("curl -u alice:hunter2 https://api.example.com/secure").auth).toEqual({ type: "basic", username: "alice", password: "hunter2" });
    expect(parseCurl("curl -u 'alice:pa:ss' https://x.io").auth).toEqual({ type: "basic", username: "alice", password: "pa:ss" });
    expect(parseCurl("curl --user bob https://x.io").auth).toEqual({ type: "basic", username: "bob", password: "" });
  });

  it("parses x-www-form-urlencoded bodies into decoded key/value pairs", () => {
    const parsed = parseCurl(
      "curl -X POST https://api.example.com/login -H 'Content-Type: application/x-www-form-urlencoded' -d 'user=alice&pass=hunter%202&note=a+b'",
    );
    expect(parsed.body).toEqual({
      mode: "urlencoded",
      params: [h("user", "alice"), h("pass", "hunter 2"), h("note", "a b")],
    });
  });

  it("rejects input that isn't a curl command", () => {
    expect(() => parseCurl("not a curl command")).toThrow(CurlParseError);
    expect(() => parseCurl("")).toThrow(CurlParseError);
    expect(() => parseCurl("curly https://x.io")).toThrow(CurlParseError);
    expect(() => parseCurl("Invoke-WebRequest -Uri 'https://x.io'")).toThrow(CurlParseError);
  });

  it("rejects a curl command with no discoverable URL", () => {
    expect(() => parseCurl("curl -X GET -H 'Accept: json'")).toThrow("Couldn't find a URL");
  });

  it("explains an unclosed quote and an option missing its value", () => {
    expect(() => parseCurl("curl 'https://x.io -H A")).toThrow(/quote .* never closed/);
    expect(() => parseCurl("curl https://x.io -H")).toThrow("-H needs a value after it.");
  });
});

describe("looksLikeCurl / prompts / curl.exe", () => {
  it("accepts leading whitespace, $ and % prompts, and curl.exe", () => {
    for (const t of ["  curl https://x.io", "$ curl https://x.io", "% curl https://x.io", "curl.exe https://x.io", "C:\\Users\\ada> curl.exe https://x.io", "PS C:\\> curl.exe https://x.io"]) {
      expect(looksLikeCurl(t)).toBe(true);
      expect(parseCurl(t).url).toBe("https://x.io");
    }
    expect(looksLikeCurl("https://x.io")).toBe(false);
    expect(looksLikeCurl("curling")).toBe(false);
  });

  it("stops at a pipe, a redirect or a second command", () => {
    expect(parseCurl("curl -s https://x.io/a | jq .").url).toBe("https://x.io/a");
    expect(parseCurl("curl https://x.io/a > out.json").url).toBe("https://x.io/a");
    expect(parseCurl("curl https://x.io/a && echo done").url).toBe("https://x.io/a");
    const two = parseCurl("curl https://x.io/a\ncurl https://x.io/b");
    expect(two.url).toBe("https://x.io/a");
    expect(two.warnings).toEqual([]);
  });

  it("handles PowerShell backtick continuations after curl.exe", () => {
    const parsed = parseCurl('curl.exe -X POST "https://x.io/items" `\n  -H "Accept: application/json"');
    expect(parsed.method).toBe("POST");
    expect(parsed.headers).toEqual([h("Accept", "application/json")]);
  });
});

describe("Chrome / Edge — Copy as cURL (bash)", () => {
  it("GET with -b cookies, sec-* headers and --compressed", () => {
    const cmd = `curl 'https://github.com/notifications/indicator?v=2' \\
  -H 'accept: application/json' \\
  -H 'accept-language: en-US,en;q=0.9,pt;q=0.8' \\
  -b '_octo=GH1.1.123.456; logged_in=yes; tz=America%2FSao_Paulo' \\
  -H 'priority: u=1, i' \\
  -H 'referer: https://github.com/' \\
  -H 'sec-ch-ua: "Chromium";v="129", "Not=A?Brand";v="8"' \\
  -H 'sec-fetch-mode: cors' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36' \\
  --compressed`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://github.com/notifications/indicator?v=2");
    expect(parsed.params).toEqual([h("v", "2")]);
    expect(parsed.headers.map((x) => x.key)).toEqual(["accept", "accept-language", "Cookie", "priority", "referer", "sec-ch-ua", "sec-fetch-mode", "user-agent"]);
    expect(parsed.headers[2]).toEqual(h("Cookie", "_octo=GH1.1.123.456; logged_in=yes; tz=America%2FSao_Paulo"));
    expect(parsed.headers[5].value).toBe('"Chromium";v="129", "Not=A?Brand";v="8"');
    expect(parsed.body).toEqual({ mode: "none" });
  });

  it("POST with $'…' ANSI-C quoting (escaped quotes, \\n, \\u escapes and a literal !)", () => {
    const cmd = `curl 'https://api.example.com/graphql' \\
  -H 'content-type: application/json' \\
  -H 'origin: https://app.example.com' \\
  --data-raw $'{"query":"query { me { name } }","variables":{"note":"it\\'s done\\u0021\\\\nnext",\\n"path":"C:\\\\\\\\temp"}}'`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.body.mode).toBe("raw");
    const raw = parsed.body.mode === "raw" ? parsed.body.raw : "";
    expect(JSON.parse(raw)).toEqual({ query: "query { me { name } }", variables: { note: "it's done!\nnext", path: "C:\\temp" } });
  });

  it("decodes \\x byte escapes as UTF-8 and octal escapes", () => {
    const parsed = parseCurl(`curl https://x.io -H 'content-type: text/plain' --data-raw $'caf\\xc3\\xa9 \\101\\tok'`);
    expect(parsed.body).toEqual({ mode: "raw", raw: "café A\tok", language: "text" });
  });

  it("an explicit -X with --data-raw urlencoded form (login form)", () => {
    const cmd = `curl 'https://example.com/session' \\
  -X 'POST' \\
  -H 'content-type: application/x-www-form-urlencoded' \\
  -H 'cookie: _session=abc; theme=dark' \\
  --data-raw 'authenticity_token=a%2Bb%3D%3D&login=ada%40example.com&password=s3cr%26t&commit=Sign+in'`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.headers.find((x) => x.key === "cookie")?.value).toBe("_session=abc; theme=dark");
    expect(parsed.body).toEqual({
      mode: "urlencoded",
      params: [h("authenticity_token", "a+b=="), h("login", "ada@example.com"), h("password", "s3cr&t"), h("commit", "Sign in")],
    });
  });

  it("a multipart body copied by the browser becomes form-data fields", () => {
    const cmd = `curl 'https://example.com/upload' \\
  -H 'content-type: multipart/form-data; boundary=----WebKitFormBoundaryx8Qm2' \\
  --data-raw $'------WebKitFormBoundaryx8Qm2\\r\\nContent-Disposition: form-data; name="title"\\r\\n\\r\\nQ3 report\\r\\n------WebKitFormBoundaryx8Qm2\\r\\nContent-Disposition: form-data; name="doc"; filename="report.pdf"\\r\\nContent-Type: application/pdf\\r\\n\\r\\n\\r\\n------WebKitFormBoundaryx8Qm2--\\r\\n'`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.headers).toEqual([]); // the copied boundary would be wrong: rebuilt at send time
    expect(parsed.body).toEqual({
      mode: "formdata",
      fields: [
        { key: "title", value: "Q3 report", enabled: true, type: "text" },
        { key: "doc", value: "", enabled: true, type: "file", fileName: "report.pdf" },
      ],
    });
    expect(parsed.warnings.join(" ")).toContain("report.pdf");
  });
});

describe("Chrome — Copy as cURL (cmd)", () => {
  it("unescapes ^ and ^\\^\" and joins ^ line continuations", () => {
    const cmd = [
      'curl ^"https://api.example.com/v1/items?limit=10^&offset=0^" ^',
      '  -H ^"accept: application/json^" ^',
      '  -H ^"content-type: application/json^" ^',
      '  -b ^"sid=abc^%^123; theme=dark^" ^',
      '  --data-raw ^"^{^\\^"name^\\^":^\\^"Widget ^<b^>^\\^",^\\^"price^\\^":9.5,^\\^"path^\\^":^\\^"C:^\\^\\^\\^\\temp^\\^"^}^" ^',
      "  --compressed",
    ].join("\r\n");
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://api.example.com/v1/items?limit=10&offset=0");
    expect(parsed.params).toEqual([h("limit", "10"), h("offset", "0")]);
    expect(parsed.headers).toEqual([h("accept", "application/json"), h("content-type", "application/json"), h("Cookie", "sid=abc%123; theme=dark")]);
    const raw = parsed.body.mode === "raw" ? parsed.body.raw : "";
    expect(JSON.parse(raw)).toEqual({ name: "Widget <b>", price: 9.5, path: "C:\\\\temp" });
  });

  it("keeps a multi-line body (^ + two newlines is a literal newline)", () => {
    const cmd = 'curl ^"https://x.io/notes^" ^\r\n  -H ^"content-type: text/plain^" ^\r\n  --data-raw ^"line one^\r\n\r\nline two^"';
    expect(parseCurl(cmd).body).toEqual({ mode: "raw", raw: "line one\nline two", language: "text" });
  });

  it("plain double-quoted cmd commands", () => {
    const parsed = parseCurl('curl.exe -X PUT "https://x.io/items/1" -H "Content-Type: application/json" -d "{\\"done\\":true}"');
    expect(parsed.method).toBe("PUT");
    expect(parsed.body).toEqual({ mode: "raw", raw: '{\n  "done": true\n}', language: "json" });
  });
});

describe("Firefox — Copy as cURL", () => {
  it("drops Accept-Encoding, Connection and Host; keeps the rest", () => {
    const cmd = `curl 'https://developer.mozilla.org/api/v1/search?q=fetch&locale=en-US' --compressed -X POST -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' -H 'Accept: */*' -H 'Accept-Language: en-US,en;q=0.5' -H 'Accept-Encoding: gzip, deflate, br, zstd' -H 'Content-Type: application/json' -H 'Origin: https://developer.mozilla.org' -H 'Connection: keep-alive' -H 'Host: developer.mozilla.org' -H 'Content-Length: 17' -H 'Sec-Fetch-Site: same-origin' -H 'TE: trailers' --data-raw '{"page":2,"n":10}'`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.headers.map((x) => x.key)).toEqual(["User-Agent", "Accept", "Accept-Language", "Content-Type", "Origin", "Sec-Fetch-Site"]);
    expect(parsed.body).toEqual({ mode: "raw", raw: '{\n  "page": 2,\n  "n": 10\n}', language: "json" });
    expect(parsed.params).toEqual([h("q", "fetch"), h("locale", "en-US")]);
    expect(parsed.warnings).toEqual([]); // Host matched the URL
  });

  it("warns when a dropped Host header pointed somewhere else", () => {
    const parsed = parseCurl("curl http://127.0.0.1:8080/health -H 'Host: api.internal'");
    expect(parsed.headers).toEqual([]);
    expect(parsed.warnings[0]).toContain("Host header (api.internal)");
  });
});

describe("Postman code snippets", () => {
  it("--location, --header, --data with a multi-line JSON body", () => {
    const cmd = `curl --location 'https://api.example.com/v1/users' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig' \\
--data '{
    "name": "Ada",
    "tags": ["admin", "ops"],
    "id": 12345678901234567890
}'`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.auth).toEqual({ type: "bearer", token: "eyJhbGciOiJIUzI1NiJ9.e30.sig" });
    expect(parsed.headers).toEqual([h("Content-Type", "application/json")]);
    // Re-indented without re-serializing: the big number stays exact.
    expect(parsed.body).toEqual({
      mode: "raw",
      raw: '{\n  "name": "Ada",\n  "tags": [\n    "admin",\n    "ops"\n  ],\n  "id": 12345678901234567890\n}',
      language: "json",
    });
  });

  it("older snippets with --request", () => {
    const parsed = parseCurl("curl --location --request DELETE 'https://api.example.com/v1/users/42' \\\n--header 'X-Request-Id: 7'");
    expect(parsed.method).toBe("DELETE");
    expect(parsed.headers).toEqual([h("X-Request-Id", "7")]);
  });

  it("--form with quoted text values and @\"/path\" files", () => {
    const cmd = `curl --location 'https://api.example.com/upload' \\
--form 'title="Quarterly report; final"' \\
--form 'file=@"/Users/ada/Documents/report 2024.pdf"' \\
--form 'avatar=@"/home/ada/me.png";type=image/png'`;
    const parsed = parseCurl(cmd);
    expect(parsed.method).toBe("POST");
    expect(parsed.body).toEqual({
      mode: "formdata",
      fields: [
        { key: "title", value: "Quarterly report; final", enabled: true, type: "text" },
        { key: "file", value: "", enabled: true, type: "file", fileName: "report 2024.pdf", filePath: "/Users/ada/Documents/report 2024.pdf" },
        { key: "avatar", value: "", enabled: true, type: "file", fileName: "me.png", filePath: "/home/ada/me.png" },
      ],
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("--data-urlencode lines become URL-encoded fields", () => {
    const cmd = `curl --location 'https://auth.example.com/oauth/token' \\
--header 'Content-Type: application/x-www-form-urlencoded' \\
--data-urlencode 'grant_type=client_credentials' \\
--data-urlencode 'scope=read write' \\
--data-urlencode 'redirect_uri=https://app.example.com/cb?x=1&y=2'`;
    const parsed = parseCurl(cmd);
    expect(parsed.body).toEqual({
      mode: "urlencoded",
      params: [h("grant_type", "client_credentials"), h("scope", "read write"), h("redirect_uri", "https://app.example.com/cb?x=1&y=2")],
    });
  });
});

describe("hand-written commands", () => {
  it("-d @file keeps the literal and says the file can't be read", () => {
    const parsed = parseCurl("curl -X POST https://x.io/import -H 'Content-Type: application/json' -d @payload.json");
    expect(parsed.body).toEqual({ mode: "raw", raw: "@payload.json", language: "json" });
    expect(parsed.warnings[0]).toContain("@payload.json");
  });

  it("--json sets the body plus Content-Type and Accept", () => {
    const parsed = parseCurl(`curl --json '{"q":"hi"}' https://x.io/search`);
    expect(parsed.method).toBe("POST");
    expect(parsed.headers).toEqual([h("Content-Type", "application/json"), h("Accept", "application/json")]);
    expect(parsed.body).toEqual({ mode: "raw", raw: '{\n  "q": "hi"\n}', language: "json" });
  });

  it("--json doesn't override headers given explicitly", () => {
    const parsed = parseCurl(`curl --json '{}' -H 'Accept: text/event-stream' https://x.io`);
    expect(parsed.headers).toEqual([h("Accept", "text/event-stream"), h("Content-Type", "application/json")]);
    expect(parsed.body).toEqual({ mode: "raw", raw: "{}", language: "json" });
  });

  it("-G moves -d and --data-urlencode into the query", () => {
    const parsed = parseCurl("curl -G https://x.io/search?lang=en -d limit=5 --data-urlencode 'q=hello world & more'");
    expect(parsed.method).toBe("GET");
    expect(parsed.body).toEqual({ mode: "none" });
    expect(parsed.url).toBe("https://x.io/search?lang=en&limit=5&q=hello%20world%20%26%20more");
    expect(parsed.params).toEqual([h("lang", "en"), h("limit", "5"), h("q", "hello%20world%20%26%20more")]);
  });

  it("--url-query adds query params", () => {
    expect(parseCurl("curl --url-query 'name=Ada Lovelace' --url-query '+raw=a%20b' https://x.io/p").url).toBe("https://x.io/p?name=Ada%20Lovelace&raw=a%20b");
  });

  it("-F text and file fields (absolute and relative paths)", () => {
    const parsed = parseCurl("curl -F name=Ada -F 'photo=@/tmp/me.jpg;filename=avatar.jpg' -F doc=@notes.txt -F 'bio=<bio.txt' https://x.io/profile");
    expect(parsed.method).toBe("POST");
    expect(parsed.body).toEqual({
      mode: "formdata",
      fields: [
        { key: "name", value: "Ada", enabled: true, type: "text" },
        { key: "photo", value: "", enabled: true, type: "file", fileName: "avatar.jpg", filePath: "/tmp/me.jpg" },
        { key: "doc", value: "", enabled: true, type: "file", fileName: "notes.txt" },
        { key: "bio", value: "", enabled: true, type: "text" },
      ],
    });
    expect(parsed.warnings).toHaveLength(2);
  });

  it("--form-string keeps @ and ; literally", () => {
    const parsed = parseCurl("curl --form-string 'handle=@ada;type=x' https://x.io");
    expect(parsed.body).toEqual({ mode: "formdata", fields: [{ key: "handle", value: "@ada;type=x", enabled: true, type: "text" }] });
  });

  it("--url, -A, -e and -I", () => {
    const parsed = parseCurl("curl -I --url https://x.io/file.zip -A 'MyAgent/1.0' -e 'https://ref.example.com/;auto'");
    expect(parsed.method).toBe("HEAD");
    expect(parsed.url).toBe("https://x.io/file.zip");
    expect(parsed.headers).toEqual([h("User-Agent", "MyAgent/1.0"), h("Referer", "https://ref.example.com/")]);
  });

  it("ignores flags safely, and options with values consume them", () => {
    const cmd =
      "curl -sSLk -v -i --compressed --http2 --insecure -o out.json --max-time 30 --connect-timeout 5 -w '%{http_code}\\n' --retry 3 --retry-delay 2 -x http://proxy:3128 --cacert ca.pem -m 10 https://x.io/data";
    const parsed = parseCurl(cmd);
    expect(parsed.url).toBe("https://x.io/data");
    expect(parsed.method).toBe("GET");
    expect(parsed.headers).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("combined short options with an attached value (-XPOST, -sX PUT, -HAccept:…)", () => {
    expect(parseCurl("curl -XPOST https://x.io").method).toBe("POST");
    expect(parseCurl("curl -sX PUT https://x.io").method).toBe("PUT");
    expect(parseCurl("curl '-HAccept: text/csv' https://x.io").headers).toEqual([h("Accept", "text/csv")]);
  });

  it("the URL can come before or after options, with or without a scheme", () => {
    expect(parseCurl("curl localhost:3000/api/health -H 'A: b'").url).toBe("localhost:3000/api/health");
    expect(parseCurl("curl -H 'A: b' example.com").url).toBe("example.com");
    expect(parseCurl("curl '{{baseUrl}}/users/:id'").url).toBe("{{baseUrl}}/users/:id");
  });

  it("detects Basic auth in an Authorization header (base64, UTF-8)", () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode("josé:p@ss:wörd")));
    expect(parseCurl(`curl https://x.io -H 'Authorization: Basic ${b64}'`)).toMatchObject({
      auth: { type: "basic", username: "josé", password: "p@ss:wörd" },
      headers: [],
    });
    // Not base64: kept as a header.
    expect(parseCurl("curl https://x.io -H 'Authorization: Basic !!!'").headers).toEqual([h("Authorization", "Basic !!!")]);
    // Other schemes stay headers.
    expect(parseCurl("curl https://x.io -H 'Authorization: Token abc'").headers).toEqual([h("Authorization", "Token abc")]);
  });

  it("--oauth2-bearer and --digest", () => {
    expect(parseCurl("curl --oauth2-bearer tok123 https://x.io").auth).toEqual({ type: "bearer", token: "tok123" });
    const digest = parseCurl("curl --digest -u ada:pw https://x.io");
    expect(digest.auth).toEqual({ type: "basic", username: "ada", password: "pw" });
    expect(digest.warnings[0]).toContain("--digest");
  });

  it("merges -b cookies into one Cookie header; a cookie file is only a warning", () => {
    const parsed = parseCurl("curl https://x.io -H 'Cookie: a=1' -b 'b=2' -b cookies.txt");
    expect(parsed.headers).toEqual([h("Cookie", "a=1; b=2")]);
    expect(parsed.warnings[0]).toContain("cookies.txt");
  });

  it("empty header (Name;) and header removal (Name:)", () => {
    expect(parseCurl("curl https://x.io -H 'X-Empty;' -H 'Accept:'").headers).toEqual([h("X-Empty", "")]);
  });

  it("body language from Content-Type, or guessed without one", () => {
    expect(parseCurl("curl https://x.io -H 'Content-Type: application/xml' -d '<a>1</a>'").body).toEqual({ mode: "raw", raw: "<a>1</a>", language: "xml" });
    expect(parseCurl("curl https://x.io -d '[1,2]'").body).toEqual({ mode: "raw", raw: "[\n  1,\n  2\n]", language: "json" });
    // JSON with an unquoted {{variable}} isn't valid JSON: kept as written, still JSON.
    expect(parseCurl("curl https://x.io -d '{\"n\": {{count}}}'").body).toEqual({ mode: "raw", raw: '{"n": {{count}}}', language: "json" });
    expect(parseCurl("curl https://x.io -d 'hello there'").body).toEqual({ mode: "raw", raw: "hello there", language: "text" });
  });

  it("several -d are joined with &", () => {
    expect(parseCurl("curl https://x.io -d a=1 -d b=2").body).toEqual({ mode: "urlencoded", params: [h("a", "1"), h("b", "2")] });
  });

  it("-X QUERY, lowercase methods, and methods Satchel can't send", () => {
    expect(parseCurl("curl -X QUERY https://x.io -H 'Content-Type: application/json' -d '{}'").method).toBe("QUERY");
    expect(parseCurl("curl -X patch https://x.io").method).toBe("PATCH");
    const odd = parseCurl("curl -X PROPFIND https://x.io");
    expect(odd.method).toBe("GET");
    expect(odd.warnings[0]).toContain("PROPFIND");
  });

  it("warns that a GET with a body won't send it", () => {
    const parsed = parseCurl(`curl -X GET https://es.local:9200/_search -H 'Content-Type: application/json' -d '{"size":0}'`);
    expect(parsed.method).toBe("GET");
    expect(parsed.warnings[0]).toContain("QUERY or POST");
  });

  it("-T means PUT and warns about the file", () => {
    const parsed = parseCurl("curl -T backup.tar https://x.io/upload/");
    expect(parsed.method).toBe("PUT");
    expect(parsed.warnings[0]).toContain("backup.tar");
  });

  it("double quotes: backslash escapes only $ ` \" \\", () => {
    const parsed = parseCurl('curl "https://x.io" -H "X-Note: say \\"hi\\" \\$HOME \\n"');
    expect(parsed.headers).toEqual([h("X-Note", 'say "hi" $HOME \\n')]);
  });
});

describe("prettyJson", () => {
  it("re-indents without touching strings or numbers", () => {
    expect(prettyJson('{"a":[],"b":{},"c":"x, y: {z}","d":1.50e3}')).toBe('{\n  "a": [],\n  "b": {},\n  "c": "x, y: {z}",\n  "d": 1.50e3\n}');
    expect(prettyJson('{"s":"quote \\" inside"}')).toBe('{\n  "s": "quote \\" inside"\n}');
    expect(prettyJson("not json")).toBe("not json");
  });
});
