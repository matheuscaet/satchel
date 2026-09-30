import { useMemo, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";
import type { VariableContext } from "@/variables";
import { isResolved } from "@/variables";
import { cn } from "@/lib/utils";
import { textSegments } from "@/features/variables/segments";
import { jsonHighlightParts, type HighlightPart } from "./jsonHighlight";
import { isJsonWithVariables } from "./json";

const INDENT = "  ";
/** Past this, JSON coloring is skipped (variables still show): a pasted multi-MB body would mount a span per token. */
const HIGHLIGHT_LIMIT = 50_000;

interface JsonBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  context: VariableContext;
  /** JSON gets syntax colors; other raw languages only get {{variable}} tokens */
  json?: boolean;
  "aria-label"?: string;
}

/** Insert text at the caret through the browser's editing stack (keeps undo), falling back to a manual splice. */
function insertText(el: HTMLTextAreaElement, text: string, onChange: (v: string) => void) {
  if (document.execCommand?.("insertText", false, text)) return;
  const { selectionStart: s, selectionEnd: e, value } = el;
  onChange(value.slice(0, s) + text + value.slice(e));
  requestAnimationFrame(() => el.setSelectionRange(s + text.length, s + text.length));
}

function outdent(el: HTMLTextAreaElement, onChange: (v: string) => void) {
  const { selectionStart, value } = el;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const leading = value.slice(lineStart).match(/^ {1,2}/);
  if (!leading) return;
  const n = leading[0].length;
  onChange(value.slice(0, lineStart) + value.slice(lineStart + n));
  requestAnimationFrame(() => {
    const pos = Math.max(lineStart, selectionStart - n);
    el.setSelectionRange(pos, pos);
  });
}

/**
 * The body editor: a real <textarea> (transparent text) over a highlighted
 * mirror with identical metrics, plus a line-number gutter. The textarea is
 * sized by the mirror, so the pane scrolls both together.
 */
export function JsonBodyEditor({ value, onChange, context, json = true, "aria-label": ariaLabel }: JsonBodyEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const editedSinceFocus = useRef(false);
  // One text node for the whole gutter, rather than an element per line.
  const lineNumbers = useMemo(() => {
    let n = 1;
    for (let i = value.indexOf("\n"); i >= 0; i = value.indexOf("\n", i + 1)) n++;
    return Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }, [value]);
  const parts = useMemo<HighlightPart[]>(
    () =>
      json && value.length <= HIGHLIGHT_LIMIT
        ? jsonHighlightParts(value)
        : textSegments(value).map((s) => (s.kind === "var" ? { text: s.text, variable: s.key } : { text: s.text })),
    [json, value],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (e.shiftKey) outdent(e.currentTarget, onChange);
    else insertText(e.currentTarget, INDENT, onChange);
  };

  return (
    <div
      className="grid w-max min-w-full grid-cols-[auto_minmax(0,1fr)] pt-2 pb-6 font-mono text-[12.5px] leading-5 [font-variant-ligatures:none]"
      onMouseDown={(e) => {
        // clicks on the gutter / padding focus the editor at the end
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.gutter !== undefined) {
          e.preventDefault();
          const el = ref.current;
          el?.focus();
          el?.setSelectionRange(el.value.length, el.value.length);
        }
      }}
    >
      <div data-gutter aria-hidden className="pr-2.5 pl-3 text-right whitespace-pre text-fg3 opacity-60 select-none">
        {lineNumbers}
      </div>
      <div data-vf className="relative min-h-5 min-w-0 pr-4">
        <div data-vf-mirror aria-hidden className="pointer-events-none whitespace-pre text-fg">
          {parts.map((p, i) =>
            p.variable !== undefined ? (
              <span key={i} className={cn("tok", !isResolved(p.variable, context) && "tok-miss")} data-var={p.variable}>
                {p.text}
              </span>
            ) : (
              <span key={i} className={p.className}>
                {p.text}
              </span>
            ),
          )}
          {/* keep a trailing empty line's height */}
          {value.endsWith("\n") || value === "" ? " " : null}
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            editedSinceFocus.current = true;
            onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => (editedSinceFocus.current = false)}
          onBlur={() => {
            if (json && editedSinceFocus.current && !isJsonWithVariables(value))
              toast.error("Not valid JSON yet. Kept as text; it'll be sent as-is.");
            editedSinceFocus.current = false;
          }}
          aria-label={ariaLabel}
          wrap="off"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-vf-input
          className="absolute inset-0 block size-full resize-none overflow-hidden border-0 bg-transparent p-0 leading-5 whitespace-pre text-transparent caret-fg outline-0 selection:bg-brass-soft selection:text-transparent [font-variant-ligatures:none]"
        />
      </div>
    </div>
  );
}
