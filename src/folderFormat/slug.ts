/**
 * File and directory names derived from display names: lowercase ASCII,
 * words joined by "-". Accents are folded ("Configurações" → "configuracoes"),
 * anything else unsafe on Windows/macOS/Linux is dropped.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "untitled";
}

/**
 * Hands out unique names within one directory, in call order: "login",
 * then "login-2", "login-3"… `reserved` names (e.g. "folder.json") are never
 * handed out. Comparison is case-insensitive so the result also works on
 * case-insensitive file systems.
 */
export function nameAllocator(reserved: readonly string[] = []) {
  const taken = new Set(reserved.map((r) => r.toLowerCase()));
  return (base: string, suffix = ""): string => {
    let candidate = `${base}${suffix}`;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}${suffix}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}
