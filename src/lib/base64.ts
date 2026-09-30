/** Base64 of UTF-8 text (btoa alone throws on anything outside Latin-1, e.g. "josé:senha"). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
