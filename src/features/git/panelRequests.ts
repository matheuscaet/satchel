import { IS_MAC } from "@/components/common/Kbd";

/** The source control shortcut, for hints and tooltips. */
export const SOURCE_CONTROL_KBD = IS_MAC ? "⌘⇧G" : "Ctrl+Shift+G";

/**
 * "Git: Commit…" opens the panel with the message box focused. The panel is
 * opened through `ui.sourceControlOpen` (a boolean), so the focus request
 * rides along here and the panel takes it when it opens.
 */
let focusCommitOnOpen = false;

export function requestCommitFocus(): void {
  focusCommitOnOpen = true;
}

export function takeCommitFocus(): boolean {
  const v = focusCommitOnOpen;
  focusCommitOnOpen = false;
  return v;
}
