// Recognizing a curl command. Kept apart from the parser (./curl), which is
// loaded only once something actually looks like curl.

const PROMPT = /^(?:\$|%|>|#|PS [^>\n]*>|[A-Za-z]:\\[^>\n]*>)[ \t]*/;
export const CURL_WORD = /^curl(?:\.exe)?(?=\s|$)/i;

/** Leading whitespace and a shell prompt ("$ ", "% ", "C:\>", "PS C:\>") removed. */
export function stripPrompt(text: string): string {
  const t = text.replace(/^\s+/, "");
  return CURL_WORD.test(t) ? t : t.replace(PROMPT, "");
}

/** Whether pasted text is meant as a curl command ("curl …", "curl.exe …", "$ curl …"). */
export function looksLikeCurl(text: string): boolean {
  return CURL_WORD.test(stripPrompt(text));
}

type CurlParser = typeof import("./curl");
let parser: CurlParser | null = null;

/** The curl parser module, loaded on first use (the app also prefetches it when idle). */
export function loadCurlParser(): Promise<CurlParser> {
  return parser ? Promise.resolve(parser) : import("./curl").then((m) => (parser = m));
}

/** The parser if it has loaded already, so a paste handler can decide synchronously. */
export function loadedCurlParser(): CurlParser | null {
  return parser;
}
