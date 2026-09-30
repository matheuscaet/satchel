export type ParsedJson = { ok: true; value: unknown } | { ok: false };

interface Entry {
  text: string;
  parsed: ParsedJson;
  pretty?: string;
}

// A few recent bodies: the pane remounts the viewer on every tab switch, and a multi-MB body
// shouldn't be re-parsed (or re-indented) each time. Responses keep only the raw text, so
// this is also the only place a pretty copy lives.
const SIZE = 4;
const recent: Entry[] = [];

function entryFor(text: string): Entry {
  const i = recent.findIndex((e) => e.text === text);
  if (i >= 0) {
    const [hit] = recent.splice(i, 1);
    recent.unshift(hit);
    return hit;
  }
  let parsed: ParsedJson;
  try {
    parsed = { ok: true, value: JSON.parse(text) };
  } catch {
    parsed = { ok: false };
  }
  const entry: Entry = { text, parsed };
  recent.unshift(entry);
  if (recent.length > SIZE) recent.pop();
  return entry;
}

/** JSON.parse, remembered for the last few texts. */
export function parseJsonCached(text: string): ParsedJson {
  return entryFor(text).parsed;
}

/** The text indented for display, or as-is when it isn't JSON. */
export function prettyJsonCached(text: string): string {
  const entry = entryFor(text);
  if (entry.pretty === undefined) entry.pretty = entry.parsed.ok ? JSON.stringify(entry.parsed.value, null, 2) : text;
  return entry.pretty;
}
