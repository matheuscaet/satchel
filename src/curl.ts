import { HTTP_METHODS, type AuthConfig, type FormField, type HttpMethod, type KeyValue, type RequestBody } from "./types";
import { paramsFromUrl } from "./url";
import { CURL_WORD, stripPrompt } from "./curlDetect";

// Turns a pasted curl command into a request. Handles what people actually
// paste: Chrome/Edge "Copy as cURL (bash)" ($'…' quoting, -b cookies,
// --compressed), "Copy as cURL (cmd)" (^-escaped, "-quoted), Firefox,
// Postman snippets (--location, --form 'k="v"'), and hand-written commands
// (-G, --json, -u, -F, combined short flags like -sSL or -XPOST).
//
// Headers the runtime sets itself are dropped rather than pasted into the
// request, because sending them by hand does harm: Content-Length (computed
// from the body; a stale one truncates it), Host (comes from the URL — a
// copied Host would silently point a different URL at the old host),
// Connection / Keep-Alive / Transfer-Encoding / Expect (hop-by-hop), and
// Accept-Encoding (the HTTP client negotiates and decompresses itself; a
// copied one can get back bytes it doesn't decode). HTTP/2 pseudo-headers
// (":authority") are dropped too.

export class CurlParseError extends Error {}

export interface ParsedCurl {
  method: HttpMethod;
  /** As written, query string included (the URL is the source of truth for the query) */
  url: string;
  /** The URL's query as a param table */
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  /** What couldn't be carried over as-is, in plain words (a file curl would read, an unknown method…) */
  warnings: string[];
}

// Recognizing a curl command lives in ./curlDetect (small, loaded up front for paste detection).
export { looksLikeCurl } from "./curlDetect";

// ---------------------------------------------------------------------------
// Tokenizing: POSIX shells (bash/zsh) and Windows cmd.exe

const unclosed = () => new CurlParseError("A quote in that curl command is never closed. Copy the whole command and try again.");

/** $'…' (ANSI-C quoting, which Chrome uses for bodies with special characters). `i` is just past the opening quote. */
function readAnsiC(src: string, i: number): [string, number] {
  let out = "";
  let bytes: number[] = [];
  const flush = () => {
    if (bytes.length) out += new TextDecoder().decode(new Uint8Array(bytes));
    bytes = [];
  };
  const SIMPLE: Record<string, string> = {
    a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
    "\\": "\\", "'": "'", '"': '"', "?": "?",
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'") {
      flush();
      return [out, i + 1];
    }
    if (ch !== "\\") {
      flush();
      out += ch;
      i++;
      continue;
    }
    const e = src[i + 1];
    i += 2;
    if (e === undefined) break;
    if (SIMPLE[e] !== undefined) {
      flush();
      out += SIMPLE[e];
      continue;
    }
    const rest = src.slice(i);
    if (e === "x") {
      const m = /^[0-9a-fA-F]{1,2}/.exec(rest);
      if (m) {
        bytes.push(parseInt(m[0], 16)); // raw bytes: consecutive \xHH form UTF-8 sequences
        i += m[0].length;
        continue;
      }
    } else if (e === "u" || e === "U") {
      const m = (e === "u" ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(rest);
      if (m) {
        flush();
        out += String.fromCodePoint(Math.min(parseInt(m[0], 16), 0x10ffff));
        i += m[0].length;
        continue;
      }
    } else if (/[0-7]/.test(e)) {
      const m = /^[0-7]{0,2}/.exec(rest)!;
      bytes.push(parseInt(e + m[0], 8) & 0xff);
      i += m[0].length;
      continue;
    } else if (e === "c" && rest) {
      flush();
      out += String.fromCharCode(rest.charCodeAt(0) & 0x1f);
      i++;
      continue;
    }
    flush();
    out += `\\${e}`; // unknown escape: bash keeps it as written
  }
  throw unclosed();
}

/** bash/zsh word splitting and quote removal. Stops at the end of the command (|, ;, &&, >, a new "curl" line). */
function tokenizePosix(src: string, backtickContinuation: boolean): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) tokens.push(cur);
    cur = "";
    inWord = false;
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "\\" && src[i + 1] === "\n") {
      i += 2; // line continuation
      continue;
    }
    if (backtickContinuation && ch === "`" && src[i + 1] === "\n") {
      i += 2; // PowerShell's continuation, for curl.exe pasted from a PowerShell snippet
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      endWord();
      if (ch === "\n" && tokens.length > 1 && /^[ \t]*(?:\$[ \t]*)?curl(?:\.exe)?\s/i.test(src.slice(i + 1))) break;
      i++;
      continue;
    }
    if (!inWord) {
      if (ch === "|" || ch === ";" || ch === "<" || ch === ">") break;
      if (ch === "&" && (i + 1 >= n || src[i + 1] === "&" || /\s/.test(src[i + 1]))) break;
      if (ch === "#") {
        while (i < n && src[i] !== "\n") i++; // comment
        continue;
      }
    }
    inWord = true;
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw unclosed();
      cur += src.slice(i + 1, end);
      i = end + 1;
    } else if (ch === "$" && src[i + 1] === "'") {
      const [text, next] = readAnsiC(src, i + 2);
      cur += text;
      i = next;
    } else if (ch === "$" && src[i + 1] === '"') {
      i++; // $"…" is a translatable string: same as "…"
    } else if (ch === '"') {
      i++;
      for (;;) {
        if (i >= n) throw unclosed();
        const c = src[i];
        if (c === '"') break;
        if (c === "\\" && i + 1 < n && '$`"\\\n'.includes(src[i + 1])) {
          if (src[i + 1] !== "\n") cur += src[i + 1];
          i += 2;
        } else {
          cur += c;
          i++;
        }
      }
      i++;
    } else if (ch === "\\") {
      cur += src[i + 1] ?? "";
      i += 2;
    } else {
      cur += ch;
      i++;
    }
  }
  endWord();
  return tokens;
}

/**
 * Windows cmd.exe, as Chrome's "Copy as cURL (cmd)" writes it. Two layers: cmd.exe
 * removes ^ escapes (a ^ at the end of a line continues the command, and "^\n\n" is
 * a literal newline); then the program's own argument parser (MSVC rules) splits
 * words on "…" quotes, where \" is a literal quote.
 */
function tokenizeCmd(src: string): string[] {
  let pass = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      quoted = !quoted;
      pass += ch;
    } else if (ch === "^" && !quoted) {
      const next = src[i + 1];
      if (next === "\n") {
        i++;
        if (src[i + 1] === "\n") {
          pass += "\n";
          i++;
        }
      } else if (next !== undefined) {
        pass += next;
        i++;
      }
    } else if (ch === "\n" && !quoted && /^[ \t]*curl(?:\.exe)?\s/i.test(src.slice(i + 1))) {
      break; // the next command
    } else {
      pass += ch;
    }
  }

  const tokens: string[] = [];
  let cur = "";
  let inWord = false;
  let q = false;
  for (let i = 0; i < pass.length; i++) {
    const ch = pass[i];
    if (!q && /\s/.test(ch)) {
      if (inWord) tokens.push(cur);
      cur = "";
      inWord = false;
      continue;
    }
    inWord = true;
    if (ch === "\\") {
      let j = i;
      while (pass[j] === "\\") j++;
      const count = j - i;
      if (pass[j] === '"') {
        cur += "\\".repeat(Math.floor(count / 2));
        if (count % 2) {
          cur += '"';
          i = j;
        } else i = j - 1;
      } else {
        cur += "\\".repeat(count);
        i = j - 1;
      }
    } else if (ch === '"') {
      if (q && pass[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else cur += ch;
  }
  if (q) throw unclosed();
  if (inWord) tokens.push(cur);
  return tokens;
}

function tokenize(text: string): string[] {
  const src = text.replace(/\r\n?/g, "\n");
  const isCmd = /\^\n/.test(src) || /\^"/.test(src);
  if (isCmd) return tokenizeCmd(src);
  return tokenizePosix(src, /^curl\.exe/i.test(src));
}

// ---------------------------------------------------------------------------
// Options

/** Long options that take a value (curl 8.x). Anything else starting with -- is a flag. */
const LONG_WITH_VALUE = new Set(
  (
    "abstract-unix-socket alt-svc aws-sigv4 cacert capath cert cert-type ciphers config connect-timeout connect-to " +
    "continue-at cookie cookie-jar create-file-mode crlfile curves data data-ascii data-binary data-raw data-urlencode " +
    "delegation dns-interface dns-ipv4-addr dns-ipv6-addr dns-servers doh-url dump-header ech egd-file engine " +
    "etag-compare etag-save expand-data expand-header expand-url expand-user expect100-timeout form form-string " +
    "ftp-account ftp-alternative-to-user ftp-method ftp-port ftp-ssl-ccc-mode happy-eyeballs-timeout-ms " +
    "haproxy-clientip header hostpubmd5 hostpubsha256 hsts interface ip-tos ipfs-gateway json keepalive-cnt " +
    "keepalive-time key key-type krb libcurl limit-rate local-port login-options mail-auth mail-from mail-rcpt " +
    "max-filesize max-redirs max-time netrc-file noproxy oauth2-bearer output output-dir pass pinnedpubkey preproxy " +
    "proto proto-default proto-redir proxy proxy-cacert proxy-capath proxy-cert proxy-cert-type proxy-ciphers " +
    "proxy-crlfile proxy-header proxy-key proxy-key-type proxy-pass proxy-pinnedpubkey proxy-service-name " +
    "proxy-tls13-ciphers proxy-tlsauthtype proxy-tlspassword proxy-tlsuser proxy-user proxy1.0 pubkey quote " +
    "random-file range rate referer request request-target resolve retry retry-delay retry-max-time sasl-authzid " +
    "service-name socks4 socks4a socks5 socks5-gssapi-service socks5-hostname speed-limit speed-time stderr " +
    "telnet-option tftp-blksize time-cond tls-max tls13-ciphers tlsauthtype tlspassword tlsuser trace trace-ascii " +
    "trace-config unix-socket upload-file url url-query user user-agent variable vlan-priority write-out"
  ).split(" "),
);

/** Short options that take a value; the value may be attached (-XPOST) or the next word. */
const SHORT_WITH_VALUE = new Set([..."AbcCdDeEFHKmoPQrtTuUwxXyYz"]);

const SHORT_TO_LONG: Record<string, string> = {
  A: "user-agent", b: "cookie", d: "data", e: "referer", F: "form", G: "get", H: "header", I: "head",
  T: "upload-file", u: "user", X: "request",
};

type DataPart = { text: string; urlencoded: boolean };

interface State {
  urls: string[];
  method: string | null;
  headers: KeyValue[];
  data: DataPart[];
  json: boolean;
  form: FormField[];
  get: boolean;
  head: boolean;
  upload: string | null;
  auth: AuthConfig;
  authScheme: string | null;
  query: string[];
  warnings: string[];
}

/** curl's URL encoding: everything but unreserved characters. */
function curlEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** --data-urlencode / --url-query: "content", "=content", "name=content", "@file", "name@file". */
function urlencodeArg(arg: string, s: State, option: string): string | null {
  const at = arg.search(/[=@]/);
  if (at >= 0 && arg[at] === "@") {
    s.warnings.push(`${option} ${arg} reads a file Satchel can't open, so it was left out.`);
    return null;
  }
  if (at < 0) return curlEncode(arg);
  const name = arg.slice(0, at);
  const content = curlEncode(arg.slice(at + 1));
  return name ? `${name}=${content}` : content;
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function isAbsolutePath(path: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
}

/** A -F value: `"quoted"` (with \" and \\) or up to the first ;type= / ;filename= / … parameter. */
function readFormWord(s: string): { word: string; params: Record<string, string> } {
  let word: string;
  let rest: string;
  if (s.startsWith('"')) {
    word = "";
    let i = 1;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) i++;
      word += s[i++];
    }
    rest = s.slice(i + 1);
  } else {
    const m = /;\s*(?:type|filename|headers|encoder)=/i.exec(s);
    word = m ? s.slice(0, m.index) : s;
    rest = m ? s.slice(m.index) : "";
  }
  const params: Record<string, string> = {};
  for (const m of rest.matchAll(/;\s*(\w+)=("(?:[^"\\]|\\.)*"|[^;]*)/g)) {
    params[m[1].toLowerCase()] = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\(["\\])/g, "$1") : m[2].trim();
  }
  return { word, params };
}

function formField(arg: string, literal: boolean, s: State): void {
  const eq = arg.indexOf("=");
  if (eq < 0) {
    s.warnings.push(`-F ${arg} isn't name=value, so it was left out.`);
    return;
  }
  const key = arg.slice(0, eq);
  const value = arg.slice(eq + 1);
  if (literal) {
    s.form.push({ key, value, enabled: true, type: "text" });
    return;
  }
  if (value.startsWith("@")) {
    const { word: path, params } = readFormWord(value.slice(1));
    const field: FormField = { key, value: "", enabled: true, type: "file", fileName: params.filename || basename(path) };
    if (isAbsolutePath(path)) field.filePath = path;
    else s.warnings.push(`Choose the file for “${key}” in the Body tab: ${path} is relative to where curl ran.`);
    s.form.push(field);
    return;
  }
  if (value.startsWith("<")) {
    const { word: path } = readFormWord(value.slice(1));
    s.warnings.push(`“${key}” takes its text from ${path}, which Satchel can't read, so it's empty.`);
    s.form.push({ key, value: "", enabled: true, type: "text" });
    return;
  }
  s.form.push({ key, value: readFormWord(value).word, enabled: true, type: "text" });
}

function addHeader(line: string, s: State): void {
  if (line.startsWith("@")) {
    s.warnings.push(`-H ${line} reads headers from a file Satchel can't open, so they were left out.`);
    return;
  }
  const colon = line.indexOf(":");
  if (colon > 0) {
    const value = line.slice(colon + 1).trim();
    if (value !== "") s.headers.push({ key: line.slice(0, colon).trim(), value, enabled: true });
    // "Name:" with nothing after it tells curl to *remove* that header: nothing to add.
    return;
  }
  if (line.endsWith(";")) s.headers.push({ key: line.slice(0, -1).trim(), value: "", enabled: true }); // "Name;" = empty header
}

function addCookie(value: string, s: State): void {
  if (!value.includes("=")) {
    s.warnings.push(`-b ${value} names a cookie file Satchel can't read, so it was left out.`);
    return;
  }
  const existing = s.headers.find((h) => h.key.toLowerCase() === "cookie");
  if (existing) existing.value = `${existing.value.replace(/;\s*$/, "")}; ${value}`;
  else s.headers.push({ key: "Cookie", value, enabled: true });
}

function applyOption(name: string, value: string, s: State): void {
  switch (name) {
    case "request":
      s.method = value.toUpperCase();
      break;
    case "header":
      addHeader(value, s);
      break;
    case "data":
    case "data-ascii":
    case "data-binary":
      if (value.startsWith("@")) {
        s.warnings.push(`--${name} ${value} reads a file Satchel can't open; the body is the text “${value}” for now.`);
      }
      s.data.push({ text: value, urlencoded: false });
      break;
    case "data-raw":
      s.data.push({ text: value, urlencoded: false });
      break;
    case "json":
      if (value.startsWith("@")) s.warnings.push(`--json ${value} reads a file Satchel can't open; the body is the text “${value}” for now.`);
      s.data.push({ text: value, urlencoded: false });
      s.json = true;
      break;
    case "data-urlencode": {
      const text = urlencodeArg(value, s, "--data-urlencode");
      if (text !== null) s.data.push({ text, urlencoded: true });
      break;
    }
    case "url-query": {
      if (value.startsWith("+")) s.query.push(value.slice(1));
      else {
        const text = urlencodeArg(value, s, "--url-query");
        if (text !== null) s.query.push(text);
      }
      break;
    }
    case "form":
      formField(value, false, s);
      break;
    case "form-string":
      formField(value, true, s);
      break;
    case "user": {
      const colon = value.indexOf(":");
      s.auth = colon < 0 ? { type: "basic", username: value, password: "" } : { type: "basic", username: value.slice(0, colon), password: value.slice(colon + 1) };
      break;
    }
    case "oauth2-bearer":
      s.auth = { type: "bearer", token: value };
      break;
    case "url":
      s.urls.push(value);
      break;
    case "cookie":
      addCookie(value, s);
      break;
    case "user-agent":
      s.headers.push({ key: "User-Agent", value, enabled: true });
      break;
    case "referer": {
      const ref = value.replace(/;?auto$/, "");
      if (ref) s.headers.push({ key: "Referer", value: ref, enabled: true });
      break;
    }
    case "upload-file":
      s.upload = value;
      break;
    default:
      break; // everything else (output, timeouts, TLS, proxies…) doesn't change the request
  }
}

function applyFlag(name: string, s: State): void {
  switch (name) {
    case "head":
      s.head = true;
      break;
    case "get":
      s.get = true;
      break;
    case "digest":
    case "ntlm":
    case "negotiate":
    case "anyauth":
    case "ntlm-wb":
      s.authScheme = name;
      break;
    default:
      break; // -L, -k, -s, -S, -v, -i, --compressed, --http2… don't change what's sent
  }
}

// ---------------------------------------------------------------------------
// Bodies

/** Re-indent valid JSON with 2 spaces without re-serializing it (big numbers and escapes stay exactly as written). */
export function prettyJson(raw: string): string {
  try {
    JSON.parse(raw);
  } catch {
    return raw;
  }
  let out = "";
  let indent = 0;
  let inString = false;
  const newline = () => `\n${"  ".repeat(indent)}`;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += raw[++i];
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      let j = i + 1;
      while (/\s/.test(raw[j] ?? "")) j++;
      if (raw[j] === (ch === "{" ? "}" : "]")) {
        out += ch + raw[j];
        i = j;
      } else {
        indent++;
        out += ch + newline();
      }
    } else if (ch === "}" || ch === "]") {
      indent--;
      out += newline() + ch;
    } else if (ch === ",") out += `,${newline()}`;
    else if (ch === ":") out += ": ";
    else out += ch;
  }
  return out;
}

function isJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return /^\s*[{[]/.test(raw);
  } catch {
    return false;
  }
}

function decodeFormComponent(s: string): string {
  const plus = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

/** "a=1&b=two%20words" → rows; null when it doesn't look like form data. */
function urlencodedRows(raw: string, requireEquals: boolean): KeyValue[] | null {
  if (/\s/.test(raw)) return null;
  if (requireEquals && !raw.includes("=")) return null;
  return raw
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const key = eq < 0 ? pair : pair.slice(0, eq);
      const value = eq < 0 ? "" : pair.slice(eq + 1);
      return { key: decodeFormComponent(key), value: decodeFormComponent(value), enabled: true };
    });
}

/** A multipart body as the browser sent it (Chrome copies them into --data-raw) → form fields. */
function multipartFields(raw: string, boundary: string): FormField[] | null {
  const parts = raw.split(`--${boundary}`);
  const fields: FormField[] = [];
  for (const part of parts.slice(1)) {
    if (part.startsWith("--")) break;
    const p = part.replace(/^\r?\n/, "");
    const sep = /\r?\n\r?\n/.exec(p);
    if (!sep) continue;
    const head = p.slice(0, sep.index);
    const content = p.slice(sep.index + sep[0].length).replace(/\r?\n$/, "");
    const name = /;\s*name="([^"]*)"/i.exec(head)?.[1];
    if (name === undefined) continue;
    const fileName = /;\s*filename="([^"]*)"/i.exec(head)?.[1];
    if (fileName !== undefined) fields.push({ key: name, value: "", enabled: true, type: "file", ...(fileName ? { fileName } : {}) });
    else fields.push({ key: name, value: content, enabled: true, type: "text" });
  }
  return fields.length > 0 ? fields : null;
}

function headerValue(headers: KeyValue[], name: string): string | undefined {
  return [...headers].reverse().find((h) => h.key.toLowerCase() === name)?.value;
}

function bodyFromData(raw: string, s: State): RequestBody {
  const contentType = (headerValue(s.headers, "content-type") ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const boundary = /boundary=("?)([^";]+)\1/i.exec(headerValue(s.headers, "content-type") ?? "")?.[2];
    const fields = boundary ? multipartFields(raw, boundary) : null;
    if (fields) {
      // The copied boundary no longer matches: the multipart header is rebuilt at send time.
      s.headers = s.headers.filter((h) => h.key.toLowerCase() !== "content-type");
      const files = fields.filter((f) => f.type === "file" && f.fileName).map((f) => f.fileName);
      if (files.length) s.warnings.push(`Choose ${files.join(", ")} again in the Body tab: the browser didn't copy file contents.`);
      return { mode: "formdata", fields };
    }
    return { mode: "raw", raw, language: "text" };
  }
  if (contentType.includes("json")) return { mode: "raw", raw: prettyJson(raw), language: "json" };
  if (contentType.includes("x-www-form-urlencoded") || contentType === "") {
    const rows = urlencodedRows(raw, contentType === "");
    if (rows) return { mode: "urlencoded", params: rows };
  }
  if (contentType === "" && isJson(raw)) return { mode: "raw", raw: prettyJson(raw), language: "json" };
  if (contentType === "" && /^\s*[{[]/.test(raw)) return { mode: "raw", raw, language: "json" };
  if (contentType.includes("xml")) return { mode: "raw", raw, language: "xml" };
  if (contentType.includes("html")) return { mode: "raw", raw, language: "html" };
  return { mode: "raw", raw, language: "text" };
}

// ---------------------------------------------------------------------------
// Headers that become auth, or that the runtime sets itself

const DROPPED_HEADERS = new Set(["content-length", "host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "expect", "accept-encoding", "te", "upgrade"]);

function decodeBase64Utf8(b64: string): string | null {
  try {
    const binary = atob(b64.trim());
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `http://${url}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function tidyHeaders(s: State, url: string): void {
  const kept: KeyValue[] = [];
  for (const h of s.headers) {
    const name = h.key.toLowerCase();
    if (name.startsWith(":")) continue;
    if (DROPPED_HEADERS.has(name)) {
      if (name === "host" && hostOf(url) !== null && hostOf(url) !== h.value.toLowerCase()) {
        s.warnings.push(`The Host header (${h.value}) was left out: Satchel sends the URL's host.`);
      }
      continue;
    }
    if (name === "authorization") {
      const bearer = /^Bearer\s+(.+)$/i.exec(h.value);
      if (bearer) {
        s.auth = { type: "bearer", token: bearer[1].trim() };
        continue;
      }
      const basic = /^Basic\s+([A-Za-z0-9+/=_-]+)$/i.exec(h.value);
      const decoded = basic ? decodeBase64Utf8(basic[1]) : null;
      if (decoded !== null) {
        const colon = decoded.indexOf(":");
        s.auth = { type: "basic", username: colon < 0 ? decoded : decoded.slice(0, colon), password: colon < 0 ? "" : decoded.slice(colon + 1) };
        continue;
      }
    }
    kept.push(h);
  }
  s.headers = kept;
}

// ---------------------------------------------------------------------------

function looksLikeUrl(word: string): boolean {
  return /^[a-z][\w+.-]*:\/\//i.test(word) || /^\{\{/.test(word) || /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-f:]+\])(:\d+)?(\/|$)/i.test(word) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|\?|$)/.test(word);
}

function withQuery(url: string, parts: string[]): string {
  if (parts.length === 0) return url;
  const hash = url.indexOf("#");
  const base = hash < 0 ? url : url.slice(0, hash);
  const sep = !base.includes("?") ? "?" : /[?&]$/.test(base) ? "" : "&";
  return `${base}${sep}${parts.join("&")}${hash < 0 ? "" : url.slice(hash)}`;
}

export function parseCurl(input: string): ParsedCurl {
  const text = stripPrompt(input ?? "");
  if (!CURL_WORD.test(text)) {
    throw new CurlParseError("That doesn't look like a curl command — it should start with \"curl\".");
  }

  const tokens = tokenize(text).slice(1);
  const s: State = {
    urls: [], method: null, headers: [], data: [], json: false, form: [], get: false, head: false, upload: null,
    auth: { type: "none" }, authScheme: null, query: [], warnings: [],
  };
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => {
      if (i + 1 >= tokens.length) throw new CurlParseError(`${t} needs a value after it.`);
      return tokens[++i];
    };
    if (t === "--") {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const bare = t.slice(2, eq < 0 ? undefined : eq).toLowerCase();
      if (LONG_WITH_VALUE.has(bare)) applyOption(bare, eq < 0 ? next() : t.slice(eq + 1), s);
      else applyFlag(bare, s);
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let k = 1; k < t.length; k++) {
        const c = t[k];
        if (SHORT_WITH_VALUE.has(c)) {
          const rest = t.slice(k + 1);
          applyOption(SHORT_TO_LONG[c] ?? c, rest !== "" ? rest : next(), s);
          break;
        }
        applyFlag(SHORT_TO_LONG[c] ?? c, s);
      }
      continue;
    }
    positionals.push(t);
  }

  // The URL: --url, else the first word that looks like one, else the first leftover word.
  const candidates = [...s.urls, ...positionals.filter(looksLikeUrl), ...positionals.filter((p) => !looksLikeUrl(p))];
  let url = candidates[0] ?? "";
  if (!url) throw new CurlParseError("Couldn't find a URL in that curl command.");
  if (s.urls.length + positionals.filter(looksLikeUrl).length > 1) s.warnings.push("That command has more than one URL; only the first was used.");

  tidyHeaders(s, url);

  if (s.json) {
    const has = (name: string) => s.headers.some((h) => h.key.toLowerCase() === name);
    if (!has("content-type")) s.headers.push({ key: "Content-Type", value: "application/json", enabled: true });
    if (!has("accept")) s.headers.push({ key: "Accept", value: "application/json", enabled: true });
  }

  if (s.authScheme && s.auth.type === "basic") {
    s.warnings.push(`--${s.authScheme} auth isn't supported: the credentials were kept as Basic auth.`);
  }

  // Body, or query parameters with -G.
  let body: RequestBody = { mode: "none" };
  const joined = s.data.map((d) => d.text).join("&");
  if (s.get) {
    url = withQuery(url, [...s.data.map((d) => d.text).filter(Boolean), ...s.query]);
  } else {
    url = withQuery(url, s.query);
    if (s.form.length > 0) {
      body = { mode: "formdata", fields: s.form };
      if (s.data.length > 0) s.warnings.push("-F and -d can't be combined; the form fields were kept.");
    } else if (s.data.length > 0) {
      body = bodyFromData(joined, s);
    }
  }
  if (s.upload !== null) s.warnings.push(`-T ${s.upload} uploads a file Satchel can't open; set the body in the Body tab.`);

  // Method: -X wins; otherwise what curl would pick.
  let method: HttpMethod;
  const inferred: HttpMethod = s.head ? "HEAD" : s.get ? "GET" : s.upload !== null ? "PUT" : body.mode !== "none" ? "POST" : "GET";
  if (s.method && (HTTP_METHODS as string[]).includes(s.method)) method = s.method as HttpMethod;
  else {
    if (s.method) s.warnings.push(`Satchel can't send ${s.method} requests; it's ${inferred} for now.`);
    method = inferred;
  }
  if ((method === "GET" || method === "HEAD") && body.mode !== "none") {
    s.warnings.push(`${method} requests are sent without a body. Switch the method to QUERY or POST to send it.`);
  }

  return { method, url, params: paramsFromUrl(url, []), headers: s.headers, body, auth: s.auth, warnings: s.warnings };
}
