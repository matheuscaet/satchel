import { useEffect } from "react";

/** Where the native menu still earns its keep: cut / copy / paste in editable text. */
const KEEPS_NATIVE_MENU = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/**
 * Hides the webview's own right-click menu (Back, Reload, Inspect…), which has
 * no place in a desktop app. It stays in editable fields and over a text
 * selection (to copy). Anything that opens a menu of its own calls
 * preventDefault first and is left alone.
 */
export function useSuppressNativeContextMenu() {
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(KEEPS_NATIVE_MENU)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim() !== "") return;
      e.preventDefault();
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);
}

export function NativeContextMenuGuard() {
  useSuppressNativeContextMenu();
  return null;
}
